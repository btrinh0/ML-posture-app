const degrees = 180 / Math.PI;
const angle = (y, x) => Math.atan2(y, x) * degrees;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function point(data, id, w, h) {
  const p = data?.[id];
  if (
    !p ||
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    p.x < 0.01 ||
    p.x > 0.99 ||
    p.y < 0.01 ||
    p.y > 0.99 ||
    (p.visibility ?? 0) < 0.58 ||
    (p.presence ?? 1) < 0.58
  )
    return null;
  return { x: p.x * w, y: p.y * h, quality: Math.min(p.visibility, p.presence ?? 1) };
}
