#!/usr/bin/env python3
"""
Phnom Penh 3D Buildings — Data Pipeline
========================================
Fetches buildings from THREE sources and merges them:

  1. Overture Maps   — conflated OSM + Microsoft ML + Google Open Buildings
  2. Global Building Atlas (GBA) — TUM satellite-derived footprints + ML heights
  3. OSM via Overpass — direct OSM with height/levels tags

Then deduplicates, estimates missing heights, assigns khan, and writes:
  ../public/buildings_phnompenh.geojson   (full city, ~200-400k buildings)

Usage:
  pip install overturemaps geopandas shapely pandas requests pyarrow tqdm
  python fetch_buildings.py

The output file goes straight into /public so Vite serves it statically.
Total runtime: ~10-20 min depending on bandwidth.
"""

import json
import math
import urllib.request
import subprocess
import sys
import os
from pathlib import Path

import pandas as pd
import geopandas as gpd
from shapely.geometry import shape, box, mapping
from shapely import wkb
from shapely.ops import unary_union
import requests
from tqdm import tqdm

# ─── Config ───────────────────────────────────────────────────────────────────

CITY_BBOX = {
    "west":  104.780,
    "south": 11.420,
    "east":  105.010,
    "north": 11.710,
}

OUTPUT_PATH = Path(__file__).parent.parent / "public" / "buildings_phnompenh.geojson"
CACHE_DIR   = Path(__file__).parent / "_cache"
CACHE_DIR.mkdir(exist_ok=True)

# Phnom Penh's 14 khans with precise boundary polygons (simplified)
# These are used to assign each building to its correct khan
KHAN_BOUNDARIES = {
    "Doun Penh":         [11.555, 104.916, 11.598, 104.952],
    "Chamkar Mon":       [11.526, 104.893, 11.555, 104.940],
    "Prampir Makara":    [11.543, 104.890, 11.595, 104.975],
    "Tuol Kouk":         [11.568, 104.878, 11.615, 104.920],
    "Russey Keo":        [11.593, 104.883, 11.660, 104.940],
    "Sen Sok":           [11.568, 104.848, 11.632, 104.895],
    "Pou Senchey":       [11.495, 104.840, 11.570, 104.920],
    "Mean Chey":         [11.478, 104.890, 11.550, 104.960],
    "Dangkao":           [11.450, 104.840, 11.510, 104.920],
    "Chbar Ampov":       [11.520, 104.940, 11.590, 105.000],
    "Chroy Changvar":    [11.568, 104.928, 11.640, 104.985],
    "Prek Pnov":         [11.620, 104.870, 11.700, 104.960],
    "Boeng Keng Kang":   [11.535, 104.910, 11.565, 104.945],
    "Kamboul":           [11.420, 104.780, 11.510, 104.880],
}

# Build shapely boxes for spatial assignment
KHAN_BOXES = {
    name: box(b[1], b[0], b[3], b[2])
    for name, b in KHAN_BOUNDARIES.items()
}


# ─── Step 1: Overture Maps ────────────────────────────────────────────────────

def fetch_overture():
    """Download buildings from Overture Maps using official Python CLI."""
    cache_file = CACHE_DIR / "overture_buildings.geojson"
    if cache_file.exists():
        print(f"[Overture] Using cache: {cache_file}")
        return gpd.read_file(cache_file)

    print("[Overture] Downloading buildings from Overture Maps S3...")
    bbox_str = f"{CITY_BBOX['west']},{CITY_BBOX['south']},{CITY_BBOX['east']},{CITY_BBOX['north']}"

    try:
        subprocess.run([
            sys.executable, "-m", "overturemaps", "download",
            f"--bbox={bbox_str}",
            "-f", "geojson",
            "--type=building",
            "-o", str(cache_file),
        ], check=True)
    except subprocess.CalledProcessError as e:
        print(f"[Overture] Download failed: {e}")
        print("[Overture] Install with: pip install overturemaps")
        return gpd.GeoDataFrame()

    gdf = gpd.read_file(cache_file)
    print(f"[Overture] Got {len(gdf)} buildings")
    return gdf


def parse_overture(gdf):
    """Normalize Overture GeoDataFrame to our schema."""
    if gdf.empty:
        return []

    features = []
    for _, row in gdf.iterrows():
        props = row.to_dict()
        geom  = row.geometry

        # Overture height is nested: properties.height or num_floors * 3.2
        height = None
        if "height" in props and props["height"] is not None:
            try:
                height = float(props["height"])
            except (ValueError, TypeError):
                pass
        if height is None and "num_floors" in props and props["num_floors"]:
            try:
                height = float(props["num_floors"]) * 3.2
            except (ValueError, TypeError):
                pass

        features.append({
            "geometry": geom,
            "height":   height,
            "source":   "overture",
            "type":     props.get("subtype") or props.get("class") or "yes",
            "name":     props.get("names", {}).get("primary") if isinstance(props.get("names"), dict) else None,
            "levels":   props.get("num_floors"),
            "osm_id":   props.get("@id") or props.get("id"),
        })
    return features


# ─── Step 2: Global Building Atlas (GBA) ─────────────────────────────────────

def gba_tile_name():
    """
    GBA tiles are named by 5°×5° bounding boxes.
    Phnom Penh (lon≈105, lat≈11.5) → tile e100_n15_e105_n10
    """
    lon_min = math.floor(CITY_BBOX["west"] / 5) * 5
    lat_max = math.ceil(CITY_BBOX["north"] / 5) * 5
    lon_max = lon_min + 5
    lat_min = lat_max - 5

    ew_min = "e" if lon_min >= 0 else "w"
    ew_max = "e" if lon_max >= 0 else "w"
    ns_max = "n" if lat_max >= 0 else "s"
    ns_min = "n" if lat_min >= 0 else "s"

    return (
        f"{ew_min}{abs(lon_min):03d}_{ns_max}{abs(lat_max):02d}"
        f"_{ew_max}{abs(lon_max):03d}_{ns_min}{abs(lat_min):02d}.parquet"
    )


def fetch_gba():
    """Download the GBA parquet tile covering Phnom Penh."""
    tile  = gba_tile_name()
    cache = CACHE_DIR / tile

    if cache.exists():
        print(f"[GBA] Using cache: {cache}")
    else:
        url = f"https://data.source.coop/tge-labs/globalbuildingatlas-lod1/{tile}"
        print(f"[GBA] Downloading {tile} from Source Cooperative...")
        print(f"[GBA] URL: {url}")

        # Check size first
        try:
            resp = requests.head(url, timeout=15)
            size_mb = int(resp.headers.get("Content-Length", 0)) / 1024**2
            print(f"[GBA] File size: {size_mb:.0f} MB")
        except Exception:
            pass

        # Stream download with progress bar
        try:
            resp = requests.get(url, stream=True, timeout=300)
            resp.raise_for_status()
            total = int(resp.headers.get("Content-Length", 0))
            with open(cache, "wb") as f, tqdm(
                total=total, unit="B", unit_scale=True, desc="GBA tile"
            ) as bar:
                for chunk in resp.iter_content(chunk_size=1024 * 256):
                    f.write(chunk)
                    bar.update(len(chunk))
        except Exception as e:
            print(f"[GBA] Download failed: {e}")
            return gpd.GeoDataFrame()

    # Load parquet
    print("[GBA] Parsing parquet...")
    try:
        df  = pd.read_parquet(cache)
        df["geometry"] = df["geometry"].apply(lambda x: wkb.loads(x))
        gdf = gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")

        # Clip to city bbox
        city_box = box(CITY_BBOX["west"], CITY_BBOX["south"], CITY_BBOX["east"], CITY_BBOX["north"])
        gdf = gdf[gdf.geometry.intersects(city_box)].copy()
        print(f"[GBA] Got {len(gdf)} buildings in Phnom Penh")
        return gdf
    except Exception as e:
        print(f"[GBA] Parse failed: {e}")
        return gpd.GeoDataFrame()


def parse_gba(gdf):
    """Normalize GBA GeoDataFrame to our schema."""
    if gdf.empty:
        return []

    # Source abbreviations: ms=Microsoft, goo=Google, osm=OSM, ours2=TUM satellite
    SOURCE_MAP = {
        "ms":    "microsoft",
        "goo":   "google",
        "osm":   "osm",
        "ours2": "gba_satellite",
    }

    features = []
    for _, row in gdf.iterrows():
        height = None
        if "height" in row and row["height"] is not None:
            try:
                h = float(row["height"])
                if h > 0:
                    height = h
            except (ValueError, TypeError):
                pass

        src = SOURCE_MAP.get(str(row.get("source", "")), "gba")
        features.append({
            "geometry": row.geometry,
            "height":   height,
            "source":   f"gba_{src}",
            "type":     "yes",
            "name":     None,
            "levels":   None,
            "osm_id":   None,
        })
    return features


# ─── Step 3: Microsoft Global ML Building Footprints ──────────────────────────

def fetch_microsoft():
    """Download Microsoft Global ML Building Footprints from GitHub releases."""
    cache_file = CACHE_DIR / "microsoft_buildings.geojson"
    if cache_file.exists():
        print(f"[Microsoft] Using cache: {cache_file}")
        return gpd.read_file(cache_file)

    print("[Microsoft] Downloading building footprints from Microsoft GitHub...")
    # Microsoft Building Footprints are available as GeoJSON per country
    # Cambodia is in the southeast asia region
    url = (
        "https://github.com/microsoft/"
        "GlobalMLBuildingFootprints/releases/download/"
        "v2.0/cambodia.geojson"
    )

    try:
        resp = requests.get(url, stream=True, timeout=120)
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length", 0))
        with open(cache_file, "wb") as f, tqdm(
            total=total, unit="B", unit_scale=True, desc="MS Footprints"
        ) as bar:
            for chunk in resp.iter_content(chunk_size=1024 * 256):
                f.write(chunk)
                bar.update(len(chunk))
    except Exception as e:
        print(f"[Microsoft] Download failed: {e}")
        return gpd.GeoDataFrame()

    gdf = gpd.read_file(cache_file)

    # Clip to city bbox
    city_box = box(CITY_BBOX["west"], CITY_BBOX["south"], CITY_BBOX["east"], CITY_BBOX["north"])
    gdf = gdf[gdf.geometry.intersects(city_box)].copy()
    print(f"[Microsoft] Got {len(gdf)} buildings in Phnom Penh")
    return gdf


def parse_microsoft(gdf):
    """Normalize Microsoft GeoDataFrame to our schema."""
    if gdf.empty:
        return []

    features = []
    for _, row in gdf.iterrows():
        # Microsoft footprints don't include height data
        features.append({
            "geometry": row.geometry,
            "height":   None,
            "source":   "microsoft",
            "type":     "yes",
            "name":     None,
            "levels":   None,
            "osm_id":   None,
        })
    return features


# ─── Step 4: Google Open Buildings v3 ─────────────────────────────────────────

def fetch_google():
    """Download Google Open Buildings v3 data via HuggingFace or direct URL."""
    cache_file = CACHE_DIR / "google_buildings.parquet"
    if cache_file.exists():
        print(f"[Google] Using cache: {cache_file}")
        return gpd.read_parquet(cache_file)

    print("[Google] Downloading Google Open Buildings v3 data...")

    # Google Open Buildings v3 is available on HuggingFace as parquet files
    # Cambodia is in the southeast_asia region
    base_url = "https://huggingface.co/datasets/google-research-datasets/open-buildings-v3/resolve/main/"

    # The dataset is split by regions; southeast_asia covers Cambodia
    tile_name = "southeast_asia"
    parquet_url = f"{base_url}{tile_name}.parquet"

    try:
        resp = requests.get(parquet_url, stream=True, timeout=300)
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length", 0))
        with open(cache_file, "wb") as f, tqdm(
            total=total, unit="B", unit_scale=True, desc="Google Buildings"
        ) as bar:
            for chunk in resp.iter_content(chunk_size=1024 * 256):
                f.write(chunk)
                bar.update(len(chunk))
    except Exception as e:
        print(f"[Google] Download failed: {e}")
        print("[Google] Trying alternative URL format...")
        try:
            alt_url = (
                "https://storage.googleapis.com/open-buildings-data/v3/"
                "polygons_s2_level_6/geojson/southeast_asia.parquet"
            )
            resp = requests.get(alt_url, stream=True, timeout=300)
            resp.raise_for_status()
            total = int(resp.headers.get("Content-Length", 0))
            with open(cache_file, "wb") as f, tqdm(
                total=total, unit="B", unit_scale=True, desc="Google Buildings"
            ) as bar:
                for chunk in resp.iter_content(chunk_size=1024 * 256):
                    f.write(chunk)
                    bar.update(len(chunk))
        except Exception as e2:
            print(f"[Google] Alternative download also failed: {e2}")
            return gpd.GeoDataFrame()

    try:
        df = pd.read_parquet(cache_file)
        # Google uses WKB geometry
        if "geometry" in df.columns:
            df["geometry"] = df["geometry"].apply(lambda x: wkb.loads(x) if isinstance(x, (bytes, bytearray)) else x)
        gdf = gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")

        # Clip to city bbox
        city_box = box(CITY_BBOX["west"], CITY_BBOX["south"], CITY_BBOX["east"], CITY_BBOX["north"])
        gdf = gdf[gdf.geometry.intersects(city_box)].copy()
        print(f"[Google] Got {len(gdf)} buildings in Phnom Penh")
        return gdf
    except Exception as e:
        print(f"[Google] Parse failed: {e}")
        return gpd.GeoDataFrame()


def parse_google(gdf):
    """Normalize Google Open Buildings GeoDataFrame to our schema."""
    if gdf.empty:
        return []

    features = []
    for _, row in gdf.iterrows():
        # Google data includes 'area_in_meters' and confidence scores
        height = None
        # Google doesn't provide height directly, but we can estimate from area
        area_m2 = row.get("area_in_meters")
        if area_m2 and area_m2 > 0:
            # Rough heuristic: larger buildings tend to be taller
            if area_m2 > 5000:
                height = 12.0
            elif area_m2 > 1000:
                height = 8.0
            elif area_m2 > 200:
                height = 5.0

        features.append({
            "geometry": row.geometry,
            "height":   height,
            "source":   "google_open_buildings",
            "type":     "yes",
            "name":     None,
            "levels":   None,
            "osm_id":   None,
        })
    return features


# ─── Step 5: OSM via Overpass ─────────────────────────────────────────────────

def fetch_osm():
    """Fetch all buildings in PNH from Overpass, including height/levels."""
    cache = CACHE_DIR / "osm_buildings.geojson"
    if cache.exists():
        print(f"[OSM] Using cache: {cache}")
        return gpd.read_file(cache)

    print("[OSM] Querying Overpass API (this may take 2-5 min)...")
    bbox_str = f"{CITY_BBOX['south']},{CITY_BBOX['west']},{CITY_BBOX['north']},{CITY_BBOX['east']}"
    query = f"""
    [out:json][timeout:180];
    (
      way["building"]({bbox_str});
      relation["building"]({bbox_str});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        resp = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query},
            timeout=300,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"[OSM] Overpass failed: {e}")
        return gpd.GeoDataFrame()

    # Convert to GeoDataFrame
    nodes = {el["id"]: (el["lon"], el["lat"]) for el in data["elements"] if el["type"] == "node"}
    features = []
    for el in data["elements"]:
        if el["type"] != "way" or not el.get("nodes"):
            continue
        coords = [nodes[nid] for nid in el["nodes"] if nid in nodes]
        if len(coords) < 4:
            continue
        if coords[0] != coords[-1]:
            coords.append(coords[0])
        tags   = el.get("tags", {})
        height = None
        if tags.get("height"):
            try:
                height = float(str(tags["height"]).replace("m", "").strip())
            except ValueError:
                pass
        elif tags.get("building:levels"):
            try:
                height = float(tags["building:levels"]) * 3.2
            except ValueError:
                pass

        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {
                "osm_id": el["id"],
                "height": height,
                "levels": tags.get("building:levels"),
                "building_type": tags.get("building", "yes"),
                "name": tags.get("name") or tags.get("name:en"),
            }
        })

    fc = {"type": "FeatureCollection", "features": features}
    with open(cache, "w") as f:
        json.dump(fc, f)

    gdf = gpd.read_file(cache)
    print(f"[OSM] Got {len(gdf)} buildings")
    return gdf


def parse_osm(gdf):
    if gdf.empty:
        return []
    features = []
    for _, row in gdf.iterrows():
        features.append({
            "geometry": row.geometry,
            "height":   row.get("height"),
            "source":   "osm",
            "type":     row.get("building_type") or "yes",
            "name":     row.get("name"),
            "levels":   row.get("levels"),
            "osm_id":   row.get("osm_id"),
        })
    return features


# ─── Step 4: Merge + Deduplicate ──────────────────────────────────────────────

def assign_khan(centroid):
    """Return the khan name for a given centroid Point."""
    for name, poly in KHAN_BOXES.items():
        if poly.contains(centroid):
            return name
    return "Unknown"


def estimate_height(geom, building_type):
    """
    Heuristic height estimate for buildings with no height data.
    Based on footprint area and type.
    """
    area = geom.area * (111_000 ** 2)  # rough m² from degrees

    type_floors = {
        "commercial":   4,
        "retail":       3,
        "office":       6,
        "hotel":        8,
        "apartments":   5,
        "residential":  3,
        "house":        2,
        "industrial":   3,
        "warehouse":    2,
        "school":       3,
        "hospital":     5,
        "yes":          3,
    }
    t = str(building_type).lower()
    base_floors = type_floors.get(t, 3)

    # Scale by footprint: large buildings tend to be taller
    if area > 5000:
        base_floors = max(base_floors, 8)
    elif area > 1000:
        base_floors = max(base_floors, 4)

    return round(base_floors * 3.2, 1)


def merge_sources(osm_features, overture_features, gba_features, ms_features=None, goog_features=None):
    """
    Merge multiple feature lists. Deduplicate by IoU overlap > 0.4.
    Priority for height: OSM > GBA > Overture > Microsoft > Google > estimated
    """
    print("[Merge] Building spatial index...")

    all_features = []
    seen_geoms   = []

    def is_duplicate(geom, threshold=0.4):
        """Return True if geom overlaps significantly with any seen geometry."""
        for seen in seen_geoms:
            try:
                inter = geom.intersection(seen).area
                union = geom.union(seen).area
                if union > 0 and inter / union > threshold:
                    return True
            except Exception:
                pass
        return False

    def add_batch(features, label):
        added = 0
        for f in tqdm(features, desc=f"Merging {label}", unit="bldg"):
            geom = f["geometry"]
            if geom is None or geom.is_empty or not geom.is_valid:
                continue
            if is_duplicate(geom):
                continue
            seen_geoms.append(geom)
            all_features.append(f)
            added += 1
        print(f"[Merge] {label}: added {added} unique buildings")

    # Priority order: OSM (highest quality) > GBA (best height) > Overture > Microsoft > Google
    add_batch(osm_features,      "OSM")
    add_batch(gba_features,      "GBA")
    add_batch(overture_features, "Overture")
    if ms_features:
        add_batch(ms_features,  "Microsoft")
    if goog_features:
        add_batch(goog_features, "Google")

    print(f"[Merge] Total unique buildings: {len(all_features)}")
    return all_features


def build_geojson(features):
    """Convert merged features to final GeoJSON FeatureCollection."""
    print("[Output] Building GeoJSON...")
    out_features = []

    for i, f in enumerate(tqdm(features, desc="Finalizing", unit="bldg")):
        geom = f["geometry"]
        try:
            centroid = geom.centroid
            khan     = assign_khan(centroid)
            height   = f.get("height")
            if height is None or height <= 0:
                height = estimate_height(geom, f.get("type", "yes"))
                estimated = True
            else:
                estimated = False

            coords = list(geom.exterior.coords) if hasattr(geom, "exterior") else []

            out_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[round(c[0], 6), round(c[1], 6)] for c in coords]],
                },
                "properties": {
                    "id":        i,
                    "osm_id":    f.get("osm_id"),
                    "height":    round(float(height), 1) if height else None,
                    "estimated": estimated,
                    "type":      f.get("type") or "yes",
                    "name":      f.get("name"),
                    "levels":    f.get("levels"),
                    "source":    f.get("source", "unknown"),
                    "khan":      khan,
                    "hasHeight": not estimated,
                },
            })
        except Exception as e:
            continue

    return {
        "type": "FeatureCollection",
        "features": out_features,
        "metadata": {
            "total":       len(out_features),
            "city":        "Phnom Penh, Cambodia",
            "bbox":        CITY_BBOX,
            "sources":     ["OSM (Overpass)", "Global Building Atlas (TUM)", "Overture Maps", "Microsoft ML Footprints", "Google Open Buildings v3"],
            "generated":   pd.Timestamp.now().isoformat(),
        }
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Phnom Penh 3D Buildings — Data Pipeline")
    print("  Sources: OSM + GBA (TUM) + Overture + Microsoft + Google")
    print("=" * 60)

    # Fetch all sources
    print("\n[1/5] Fetching OSM buildings via Overpass...")
    osm_gdf      = fetch_osm()
    osm_features = parse_osm(osm_gdf)
    print(f"      → {len(osm_features)} OSM buildings")

    print("\n[2/5] Fetching Global Building Atlas (GBA)...")
    gba_gdf      = fetch_gba()
    gba_features = parse_gba(gba_gdf)
    print(f"      → {len(gba_features)} GBA buildings")

    print("\n[3/5] Fetching Overture Maps buildings...")
    ov_gdf       = fetch_overture()
    ov_features  = parse_overture(ov_gdf)
    print(f"      → {len(ov_features)} Overture buildings")

    print("\n[4/5] Fetching Microsoft Global ML Building Footprints...")
    ms_gdf       = fetch_microsoft()
    ms_features  = parse_microsoft(ms_gdf)
    print(f"      → {len(ms_features)} Microsoft buildings")

    print("\n[5/5] Fetching Google Open Buildings v3...")
    goog_gdf     = fetch_google()
    goog_features = parse_google(goog_gdf)
    print(f"      → {len(goog_features)} Google buildings")

    print("\n[6/6] Merging and deduplicating...")
    merged  = merge_sources(osm_features, ov_features, gba_features, ms_features, goog_features)
    geojson = build_geojson(merged)

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))  # compact

    size_mb = OUTPUT_PATH.stat().st_size / 1024**2
    print(f"\n✅ Done! Wrote {len(geojson['features']):,} buildings → {OUTPUT_PATH}")
    print(f"   File size: {size_mb:.1f} MB")

    # Source breakdown
    from collections import Counter
    sources = Counter(f["properties"]["source"] for f in geojson["features"])
    print("\n   Source breakdown:")
    for src, cnt in sorted(sources.items(), key=lambda x: -x[1]):
        print(f"     {src:<20} {cnt:>8,}")


if __name__ == "__main__":
    main()
