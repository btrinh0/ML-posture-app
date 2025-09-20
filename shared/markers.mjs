export function patchCenter(frame, center, radius, cyan) {
  const x0 = Math.max(0, Math.floor(center.x - radius)), y0 = Math.max(0, Math.floor(center.y - radius));
  const w = Math.min(frame.width, Math.ceil(center.x + radius + 1)) - x0;
  const h = Math.min(frame.height, Math.ceil(center.y + radius + 1)) - y0;
  if (w < 1 || h < 1) return null;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * ((y + y0) * frame.width + x + x0);
    const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
    const hi = cyan ? Math.min(g, b) : Math.min(r, b), lo = cyan ? r : g;
    if (hi > 85 && hi - lo > 43 && Math.abs((cyan ? g : r) - b) < 85) mask[y * w + x] = 1;
  }
  const found = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    mask[i] = 0;
    const stack = [i];
    let count = 0, sx = 0, sy = 0, xmin = w, xmax = 0, ymin = h, ymax = 0;
    function take(j) { if (mask[j]) { mask[j] = 0; stack.push(j); } }
    while (stack.length) {
      const pos = stack.pop(), x = pos % w, y = Math.floor(pos / w);
      count++; sx += x; sy += y;
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      if (x > 0) take(pos - 1);
      if (x + 1 < w) take(pos + 1);
      if (y > 0) take(pos - w);
      if (y + 1 < h) take(pos + w);
    }
    const width = xmax - xmin + 1, height = ymax - ymin + 1;
    if (count >= 4 && Math.max(width, height) <= Math.max(5, radius * .48) &&
        Math.min(width, height) >= .45 * Math.max(width, height) && count >= .45 * width * height)
      found.push({ x: x0 + sx / count, y: y0 + sy / count });
  }
  return found.length === 1 ? found[0] : null;
}
