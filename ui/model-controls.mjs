import { $, act, feedback } from './dashboard.mjs';
import { setClassifier } from './sensor.mjs';
import { openClassifier } from './classifier.mjs';

const names = { rules: 'Benchmarked static rules', tree: 'LightGBM', cnn: 'Temporal 1D CNN' };
let current;

function lazyClassifier(bundle) {
  let loading;
  let revision = 0;
  return {
    reset() {
      revision++;
      loading?.then((model) => model.reset(), () => {});
    },
    async push(second, vector) {
      const at = revision;
      loading ??= openClassifier(bundle);
      const model = await loading;
      return revision === at ? model.push(second, vector) : null;
    },
    async close() {
      revision++;
      if (loading) await loading.then((model) => model.close(), () => {});
    },
  };
}
async function select(mode) {
  const controls = ['import-model', 'remove-model'].map($);
  controls.forEach((button) => { button.disabled = true; });
  try {
    if (mode === 'rules' && !(await act('removeModel'))) return;
    const pick = mode === 'import';
    const bundle = mode === 'rules' ? null : await window.desk.model(pick);
    if (pick && !bundle) return;
    const replacement = bundle ? (pick ? await openClassifier(bundle) : lazyClassifier(bundle)) : null;
    if (pick && !(await act('installModel'))) {
      await replacement.close();
      return;
    }
    const previous = current;
    current = replacement;
    setClassifier(current);
    await previous?.close();
    const source = bundle?.provenance === 'simulated_study' ? 'trained on simulated sessions' : 'trained on study exports';
    const variant = bundle?.variant === 'mean_and_latest' ? ' (mean and latest values)' : '';
    $('model-name').textContent = bundle ? names[bundle.kind] + variant + ' · ' + source + ' · 20-second windows' : 'Static posture rules';
    $('remove-model').hidden = !bundle;
  } catch (err) {
    feedback('Could not load the activity model. ' + err.message);
  } finally {
    controls.forEach((button) => { button.disabled = false; });
  }
}
$('import-model').onclick = () => select('import');
$('remove-model').onclick = () => select('rules');
void select('saved');
