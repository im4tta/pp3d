import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { heightToColor, estimatedHeightColor, khanToColor } from './heightColor'

export async function exportGLB(features, colorMode = 'height') {
  const scene = new THREE.Scene()

  const geoGroup = new THREE.Group()
  const materialCache = {}

  function getMaterial(color, isRoof = false) {
    const key = color.join(',') + (isRoof ? '-roof' : '')
    if (materialCache[key]) return materialCache[key]
    const c = isRoof
      ? color.map((v, i) => (i < 3 ? Math.round(v * 0.85) : v))
      : color
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(`rgb(${c.slice(0, 3).join(',')})`),
      roughness: isRoof ? 0.7 : 0.5,
      metalness: isRoof ? 0.1 : 0.2,
      flatShading: false,
    })
    materialCache[key] = mat
    return mat
  }

  for (const f of features) {
    const coords = f.geometry?.coordinates?.[0]
    if (!coords || coords.length < 4) continue

    const height = Math.max(Number(f.properties?.height) || 4, 3)
    if (height < 0.5) continue

    const color = colorMode === 'khan'
      ? khanToColor(f.properties?.khan, 230)
      : f.properties?.estimated
        ? estimatedHeightColor(f.properties.height, 215)
        : heightToColor(f.properties.height, 245)

    const shape = new THREE.Shape()
    const first = coords[0]
    shape.moveTo(first[0], first[1])
    for (let i = 1; i < coords.length - 1; i++) {
      shape.lineTo(coords[i][0], coords[i][1])
    }
    shape.closePath()

    const center = centroid(coords)
    const extent = Math.max(
      Math.max(...coords.map(c => c[0])) - Math.min(...coords.map(c => c[0])),
      Math.max(...coords.map(c => c[1])) - Math.min(...coords.map(c => c[1]))
    )

    const geoCoords = coords.map(c => [(c[0] - center[0]) * 111320, (c[1] - center[1]) * 111320])

    const shapeLocal = new THREE.Shape()
    shapeLocal.moveTo(geoCoords[0][0], geoCoords[0][1])
    for (let i = 1; i < geoCoords.length - 1; i++) {
      shapeLocal.lineTo(geoCoords[i][0], geoCoords[i][1])
    }
    shapeLocal.closePath()

    const extrudeSettings = {
      depth: height,
      bevelEnabled: true,
      bevelThickness: 0.3,
      bevelSize: 0.15,
      bevelSegments: 2,
    }

    const geometry = new THREE.ExtrudeGeometry(shapeLocal, extrudeSettings)
    const wallMat = getMaterial(color, false)
    const roofMat = getMaterial(color, true)
    const mesh = new THREE.Mesh(geometry, [wallMat, roofMat])
    mesh.position.set(center[0] * 111320, center[1] * 111320, 0)
    mesh.rotation.x = -Math.PI / 2
    geoGroup.add(mesh)
  }

  scene.add(geoGroup)

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
  scene.add(hemiLight)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
  dirLight.position.set(50, 100, 50)
  scene.add(dirLight)

  const exporter = new GLTFExporter()
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, trs: false, onlyVisible: true }
    )
  })

  const blob = new Blob([glb], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const ts = new Date().toISOString().slice(0, 10)
  a.download = `phnompenh-3d-${ts}.glb`
  a.click()
  URL.revokeObjectURL(url)
}

function centroid(coords) {
  let lon = 0, lat = 0
  for (const c of coords) { lon += c[0]; lat += c[1] }
  return [lon / coords.length, lat / coords.length]
}
