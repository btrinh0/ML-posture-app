const sides = {
  left: { ear: 7, shoulder: 11, hip: 23 },
  right: { ear: 8, shoulder: 12, hip: 24 },
};

export const calibrationTime = 3000;
export const cueCooldown = 45_000;
export const sensitivities = { gentle: 0.16, balanced: 0.115, responsive: 0.085 };
const maxFrameGap = 900;

function visible(point, minimum) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x > 0.02 && point.x < 0.98 && point.y > 0.02 && point.y < 0.98
    && point.visibility >= minimum && (point.presence ?? 1) >= minimum;
}

export function measurePose(landmarks, width, height, baseline = null) {
  if (!landmarks || !(width > 0 && height > 0)) return null;
  const nose = landmarks[0];
  if (!visible(nose, 0.5)) return null;

  const pixel = (point) => ({ x: point.x * width, y: point.y * height });
  const samples = [];
  for (const [side, ids] of Object.entries(sides)) {
    if (baseline && side !== baseline.side) continue;
    const { [ids.ear]: ear, [ids.shoulder]: shoulder, [ids.hip]: hip } = landmarks;
    if (!visible(ear, 0.55) || !visible(shoulder, 0.6) || !visible(hip, 0.5)) continue;

    const a = pixel(ear);
    const b = pixel(shoulder);
    const c = pixel(hip);
    const n = pixel(nose);
    const torso = Math.hypot(b.x - c.x, b.y - c.y);
    if (torso < height * 0.16 || b.y >= c.y || a.y >= b.y) continue;

    const noseSpan = (n.x - a.x) / torso;
    if (Math.abs(noseSpan) < 0.085 || Math.abs(noseSpan) > 0.52) continue;
    const facing = Math.sign(noseSpan);
    const other = landmarks[side === 'left' ? 12 : 11];
    if (visible(other, 0.60) && Math.abs(b.x - other.x * width) / torso > 0.48) continue;

    // Project onto the forward direction perpendicular to the torso in the image.
    const upX = (b.x - c.x) / torso;
    const upY = (b.y - c.y) / torso;
    const forwardX = -upY * facing;
    const forwardY = upX * facing;
    const offset = ((a.x - b.x) * forwardX + (a.y - b.y) * forwardY) / torso;
    const pitch = Math.atan2((n.x - a.x) * upX + (n.y - a.y) * upY,
      (n.x - a.x) * forwardX + (n.y - a.y) * forwardY);
    const scale = torso / height;
    if (baseline && (facing !== baseline.facing
      || Math.abs(pitch - baseline.pitch) > Math.PI / 7
      || Math.abs(scale / baseline.scale - 1) > 0.32)) continue;

    const confidence = Math.min(ear.visibility, shoulder.visibility, hip.visibility);
    samples.push({ side, facing, offset, pitch, scale, points: [a, b, c], confidence });
  }
  samples.sort((a, b) => b.confidence - a.confidence);
  return samples[0] ?? null;
}

function percentile(sorted, fraction) {
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function median(samples, key) {
  return percentile(samples.map((sample) => sample[key]).sort((a, b) => a - b), 0.5);
}

export class PostureTracker {
  baseline = null;
  calibrating = false;
  samples = [];
  startedAt = null;
  lastFrame = null;
  smoothed = null;
  pendingSince = null;
  lastCue = -Infinity;
  cued = false;

  calibrate() {
    this.baseline = null;
    this.calibrating = true;
    this.samples = [];
    this.startedAt = null;
    this.lastFrame = null;
    this.smoothed = null;
    this.pendingSince = null;
    this.cued = false;
  }

  update(sample, now, { muted = false, delay = 8000, threshold = sensitivities.balanced } = {}) {
    const elapsed = this.lastFrame === null ? 0 : now - this.lastFrame;
    this.lastFrame = sample ? now : null;
    if (!sample || elapsed > maxFrameGap) {
      this.pendingSince = null;
      this.smoothed = null;
      this.samples = [];
      this.startedAt = null;
    }
    if (!this.baseline) return this.acquire(sample, now);
    if (!sample) return { status: 'away' };

    const delta = sample.offset - this.baseline.offset;
    const weight = 1 - Math.exp(-elapsed / 450);
    this.smoothed = this.smoothed === null ? delta : this.smoothed + (delta - this.smoothed) * weight;
    // Re-arm only once the user has moved appreciably back toward their reference.
    if (this.smoothed < threshold * 0.65) this.cued = false;
    if (muted) {
      this.pendingSince = null;
      return { status: 'muted' };
    }
    if (this.smoothed < threshold || this.cued) {
      this.pendingSince = null;
      return { status: this.cued ? 'cue' : 'tracking' };
    }
    if (now - this.lastCue < cueCooldown) return { status: 'tracking' };
    this.pendingSince ??= now;
    const progress = Math.min(1, (now - this.pendingSince) / delay);
    if (progress < 1) return { status: 'shifting', progress };

    this.cued = true;
    this.lastCue = now;
    this.pendingSince = null;
    return { status: 'cue', alert: true };
  }

  acquire(sample, now) {
    if (!this.calibrating) return { status: sample ? 'ready' : 'framing' };
    if (!sample) return { status: 'hold', progress: 0 };

    const first = this.samples[0];
    if (first && (first.side !== sample.side || first.facing !== sample.facing)) {
      this.samples = [];
      this.startedAt = null;
    }
    this.startedAt ??= now;
    this.samples.push(sample);
    const progress = Math.min(1, (now - this.startedAt) / calibrationTime);
    if (progress < 1 || this.samples.length < 6) return { status: 'calibrating', progress };

    const offsets = this.samples.map(({ offset }) => offset).sort((a, b) => a - b);
    if (percentile(offsets, 0.9) - percentile(offsets, 0.1) > 0.055) {
      this.samples = [];
      this.startedAt = null;
      return { status: 'hold', progress: 0 };
    }

    this.baseline = {
      side: sample.side,
      facing: sample.facing,
      offset: median(this.samples, 'offset'),
      pitch: median(this.samples, 'pitch'),
      scale: median(this.samples, 'scale'),
    };
    this.calibrating = false;
    this.samples = [];
    this.startedAt = null;
    return { status: 'tracking', calibrated: true };
  }
}
