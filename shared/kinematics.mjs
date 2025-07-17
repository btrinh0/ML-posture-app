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
  if (view === 'front') {
    const lh = p(23),
      rh = p(24);
    if (!left || !right || !lh || !rh) return null;
    const width = Math.abs(left.x - right.x),
      torso = (distance(left, lh) + distance(right, rh)) / 2;
    if (
      torso < 0.16 * h ||
      width < 0.48 * torso ||
      width > 1.8 * torso ||
      nose.y >= (left.y + right.y) / 2 ||
      Math.abs(nose.x - (left.x + right.x) / 2) > 0.6 * width ||
      Math.abs(lh.x - rh.x) < 0.22 * torso ||
      left.y + right.y >= lh.y + rh.y
    )
      return null;
    return { view, key: 'front', scale: torso / h, raw: [angle(right.y - left.y, width)] };
  }
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
    const faceWidth = Math.abs(nose.x - ear.x) / torso;
    if (
      torso < 0.16 * h ||
      shoulder.y >= hip.y ||
      ear.y >= shoulder.y ||
      faceWidth < 0.065 ||
      faceWidth > 0.65 ||
      (left && right && Math.abs(left.x - right.x) > torso * 0.48)
    )
      continue;
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

export class Calibration {
  samples = [];
  reference = null;
  update(g, time) {
    if (!g) return 0;
    this.samples.push({ ...g, time });
    const progress = Math.min(1, (time - this.samples[0].time) / 10_000);
    if (progress < 1 || this.samples.length < 10) return progress;
    const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
    this.reference = { key: g.key, view: g.view, scale: mean(this.samples.map((s) => s.scale)),
      raw: g.raw.map((_, i) => mean(this.samples.map((s) => s.raw[i]))) };
    this.samples = [];
    return 1;
  }
}

export const forwardMoment = (offset) => Math.max(0, offset) * 0.5 * 10 * 4.44822;
export const leverLoad = (moment) => moment / (0.1 * 4.44822);
