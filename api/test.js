export default (req, res) => {
  res.json({ ok: true, node: process.version, method: req.method })
}
