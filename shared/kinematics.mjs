const degrees = 180 / Math.PI;
const angle = (y, x) => Math.atan2(y, x) * degrees;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function point(data, id, w, h) {
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

export function geometry(data, w, h, view, reference = null) {
  if (!(w > 0 && h > 0)) return null;
  const p = (id) => point(data, id, w, h);
  const nose = p(0);
  if (!nose) return null;
  const left = p(11),
    right = p(12);
  if (view !== 'side') return null;
  const candidates = [];
  for (const [id, ear, shoulder, hip] of [
    ['left', p(7), left, p(23)],
    ['right', p(8), right, p(24)],
  ]) {
    if (!ear || !shoulder || !hip) continue;
    const torso = distance(shoulder, hip),
      facing = Math.sign(nose.x - ear.x);
    const key = id + facing;
    if (reference && reference.key !== key) continue;
    if (torso < 0.16 * h || shoulder.y >= hip.y || ear.y >= shoulder.y) continue;
    const ux = (shoulder.x - hip.x) / torso,
      uy = (shoulder.y - hip.y) / torso;
    const dx = (ear.x - shoulder.x) / torso,
      dy = (ear.y - shoulder.y) / torso;
    const forward = facing * (-uy * dx + ux * dy),
      up = ux * dx + uy * dy;
    if (up <= 0.04) continue;
    const pitch = angle(-(nose.y - ear.y), facing * (nose.x - ear.x));
    const coordinates = [nose, ear, shoulder].flatMap((a) => [
      (facing * (a.x - hip.x)) / torso,
      (hip.y - a.y) / torso,
    ]);
    candidates.push({
      key,
      view,
      scale: torso / h,
      quality: Math.min(ear.quality, shoulder.quality, hip.quality),
      raw: [angle(up, forward), forward, pitch, coordinates[4], ...coordinates],
    });
  }
  return candidates.sort((a, b) => b.quality - a.quality)[0] ?? null;
}

export const forwardMoment = (offset) => Math.max(0, offset) * 0.5 * 10 * 4.44822;
export const leverLoad = (moment) => moment / (0.1 * 4.44822);
