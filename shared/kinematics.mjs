export const channelNames = [
  'cva_drop_deg',
  'head_forward_delta',
  'pitch_delta_deg',
  'shoulder_forward_delta',
  'nose_x',
  'nose_y',
  'ear_x',
  'ear_y',
  'shoulder_x',
  'shoulder_y',
];
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

const quantile = (values, fraction) =>
  values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
export class Calibration {
  samples = [];
  reference = null;
  update(g, time) {
    if (
      !g ||
      (this.last !== undefined && (time - this.last > 1600 || time <= this.last)) ||
      this.samples[0]?.key !== g.key
    )
      this.samples = [];
    this.last = time;
    if (!g) return 0;
    this.samples.push({ ...g, time });
    const progress = Math.min(1, (time - this.samples[0].time) / 10_000);
    if (progress < 1 || this.samples.length < 10) return progress;
    const angles = this.samples.map((v) => v.raw[0]);
    const scales = this.samples.map((v) => v.scale);
    if (
      quantile(angles, 0.9) - quantile(angles, 0.1) > 5 ||
      quantile(scales, 0.9) / quantile(scales, 0.1) > 1.12
    ) {
      this.samples = [];
      return 0;
    }
    this.reference = {
      key: g.key,
      view: g.view,
      scale: quantile(scales, 0.5),
      raw: g.raw.map((_, i) =>
        quantile(
          this.samples.map((v) => v.raw[i]),
          0.5,
        ),
      ),
    };
    this.samples = [];
    return 1;
  }
}

export function calibrated(g, ref) {
  if (!g || !ref || g.key !== ref.key || g.view !== ref.view || Math.abs(g.scale / ref.scale - 1) > 0.3)
    return null;
  const delta = g.raw.map((v, i) => v - ref.raw[i]);
  if (g.view === 'front') {
    return {
      view: 'front',
      cva: null,
      drop: null,
      forward: null,
      shoulder: null,
      asym: delta[0],
      moment: null,
      load: null,
      vector: null,
    };
  }
  const [cva, forward] = g.raw;
  delta[0] = -delta[0];
  // Assumes a 10 lbf head, 0.50 m torso and 0.10 m lever.
  const moment = Math.max(0, forward) * 0.5 * 10 * 4.44822;
  return {
    view: 'side',
    cva,
    drop: delta[0],
    forward: delta[1],
    shoulder: delta[3],
    asym: null,
    moment,
    load: moment / (0.1 * 4.44822),
    vector: delta,
  };
}
export const drifting = (m) =>
  Boolean(m && (m.view === 'front' ? Math.abs(m.asym) >= 5 : m.drop >= 7 || m.forward >= 0.1));
