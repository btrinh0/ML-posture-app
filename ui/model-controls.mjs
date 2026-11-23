import { $, act, feedback } from './dashboard.mjs';
import { setClassifier } from './sensor.mjs';
import { openClassifier } from './classifier.mjs';

let current = null;
const names = { rules: 'Benchmarked static rules', tree: 'LightGBM', cnn: 'Temporal 1D CNN' };
async function load(pick) {
  $('import-model').disabled = true;
  let replacement;
  try {
    const bundle = await window.desk.model(pick);
    if (!bundle) return;
    replacement = await openClassifier(bundle);
    if (pick && !(await act('installModel'))) {
      await replacement.close();
      return;
    }
    const previous = current;
    current = replacement;
    setClassifier(current);
    await previous?.close();
    $('model-name').textContent = names[bundle.kind] + ' · local ONNX CPU inference · 20-second windows';
    $('remove-model').hidden = false;
  } catch (err) {
    feedback('Could not load the activity model. ' + err.message);
  } finally {
    $('import-model').disabled = false;
  }
}
$('import-model').onclick = () => load(true);
$('remove-model').onclick = async () => {
  if (!(await act('removeModel'))) return;
  setClassifier(null);
  const previous = current;
  current = null;
  await previous?.close();
  $('model-name').textContent = 'Static posture rules';
  $('remove-model').hidden = true;
};
void load(false);
