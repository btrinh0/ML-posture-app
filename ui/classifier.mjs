import { validateBundle } from './shared/model-format.mjs';
import { WindowBuffer, rollingFeatures } from './shared/windows.mjs';
import { labels, secondsPerWindow, channelNames } from './shared/kinematics.mjs';

export async function openClassifier(bundle, allowFixture = false) {
  validateBundle(bundle,allowFixture);
  const ort = await import('./vendor/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = new URL('./vendor/',import.meta.url).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const bytes = Uint8Array.fromBase64(bundle.model);
  const session = await ort.InferenceSession.create(bytes, { executionProviders:['wasm'], graphOptimizationLevel:'all' });
  const buffer = new WindowBuffer();
  async function classify(rows) {
    const start = performance.now();
    const feature = bundle.kind === 'tree';
    const data = new Float32Array(feature ? rollingFeatures(rows) : rows.flat());
    const input = new ort.Tensor('float32',data,feature ? [1,data.length] : [1,secondsPerWindow,channelNames.length]);
    let result;
    try {
      result = await session.run({ input });
      const output = result.scores?.data;
      if (!output || output.length !== labels.length || !output.every(Number.isFinite)) throw new Error('The model returned invalid scores.');
      return { label:labels[output.indexOf(Math.max(...output))],latency:performance.now()-start };
    } finally {
      input.dispose();
      if (result) Object.values(result).forEach(t => t.dispose());
    }
  }
  try { await classify(Array.from({ length:secondsPerWindow }, () => Array(channelNames.length).fill(0))); }
  catch (err) { await session.release(); throw err; }
  return { classify, reset:() => buffer.clear(), close:() => session.release(),
    push:(second,vector) => { const rows = buffer.push(second,vector); return rows ? classify(rows) : null; } };
}
