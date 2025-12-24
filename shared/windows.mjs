import { channelNames, secondsPerWindow } from './kinematics.mjs';

export function rollingFeatures(rows) {
  const n = rows.length,
    mid = (n - 1) / 2,
    denom = (n * (n * n - 1)) / 12;
  const means = [],
    spread = [],
    slopes = [];
  for (let j = 0; j < channelNames.length; j++) {
    const mean = rows.reduce((s, r) => s + r[j], 0) / n;
    means.push(mean);
    spread.push(Math.sqrt(rows.reduce((s, r) => s + (r[j] - mean) ** 2, 0) / n));
    slopes.push(rows.reduce((s, r, i) => s + (i - mid) * r[j], 0) / denom);
  }
  let dwell = 0,
    count = 0;
  for (const row of rows) {
    const drift = row[0] >= 7 || row[1] >= 0.1;
    dwell = drift ? dwell + 1 : 0;
    if (drift) count++;
  }
  return [...means, ...spread, ...slopes, ...rows.at(-1), count / n, dwell];
}
export class WindowBuffer {
  rows = [];
  last = null;
  clear() {
    this.rows = [];
    this.last = null;
  }
  push(sec, vector) {
    if (!Number.isInteger(sec) || vector.length !== channelNames.length || !vector.every(Number.isFinite)) {
      this.clear();
      return null;
    }
    if (this.last === sec) return null;
    if (this.last !== sec - 1) this.clear();
    this.last = sec;
    this.rows.push(vector);
    if (this.rows.length > secondsPerWindow) this.rows.shift();
    return this.rows.length === secondsPerWindow ? this.rows : null;
  }
}
