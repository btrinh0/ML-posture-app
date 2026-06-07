export class CameraRate {
  constructor(track) {
    this.track = track;
    this.target = null;
    this.revision = 0;
    this.pending = Promise.resolve();
  }
  set(rate) {
    if (this.target === rate) return this.pending;
    this.target = rate;
    const revision = ++this.revision;
    this.track.enabled = rate > 0;
    this.pending = this.pending.then(async () => {
      const track = this.track;
      if (!rate || revision !== this.revision || track.readyState === 'ended' || !track.applyConstraints) return;
      let limits;
      try { limits = track.getCapabilities?.().frameRate; } catch { /* Some cameras omit capabilities. */ }
      const fps = Math.max(limits?.min ?? 0, Math.min(rate, limits?.max ?? rate));
      try {
        await track.applyConstraints({ frameRate: { ideal: fps, max: fps } });
      } catch {
        if (this.revision === revision && track.readyState !== 'ended')
          await track.applyConstraints({ frameRate: { ideal: fps } }).catch(() => {});
      }
    });
    return this.pending;
  }
}
