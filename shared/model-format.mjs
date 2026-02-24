import { channelNames, labels, secondsPerWindow } from './kinematics.mjs';

export function validateBundle(b, allowFixture = false) {
  if (
    b?.format !== 'deskframe.model.v1' ||
    !['rules', 'tree', 'cnn'].includes(b.kind) ||
    b.seconds !== secondsPerWindow ||
    JSON.stringify(b.labels) !== JSON.stringify(labels) ||
    JSON.stringify(b.channels) !== JSON.stringify(channelNames) ||
    typeof b.model !== 'string' ||
    b.model.length > 8 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(b.model)
  ) {
    throw new Error('Choose a compatible Deskframe model from the benchmark exporter.');
  }
  if (!['user_sessions', 'simulated_study'].includes(b.provenance) && !(allowFixture && b.provenance === 'synthetic_smoke')) {
    throw new Error(
      'This model is marked as a synthetic test fixture. Import a model trained on study exports.',
    );
  }
  return b;
}
