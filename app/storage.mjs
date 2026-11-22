const prefix = 'formline.';

export function read(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(prefix + key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(prefix + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const defaultSettings = {
  delay: 8,
  sensitivity: 'balanced',
  sound: true,
  awake: true,
};

export function readSettings() {
  const saved = read('settings', {});
  return {
    delay: [5, 8, 12, 20].includes(saved.delay) ? saved.delay : defaultSettings.delay,
    sensitivity: ['gentle', 'balanced', 'responsive'].includes(saved.sensitivity)
      ? saved.sensitivity : defaultSettings.sensitivity,
    sound: typeof saved.sound === 'boolean' ? saved.sound : defaultSettings.sound,
    awake: typeof saved.awake === 'boolean' ? saved.awake : defaultSettings.awake,
  };
}

const comfortOptions = ['Comfortable', 'Okay', 'Uncomfortable'];

export function readActivity() {
  const saved = read('activity', []);
  if (!Array.isArray(saved)) return [];
  return saved.filter((entry) => entry && typeof entry.id === 'string'
    && ['session', 'break'].includes(entry.type)
    && Number.isFinite(entry.startedAt) && entry.startedAt > 0
    && Number.isFinite(entry.duration) && entry.duration >= 0
    && Number.isInteger(entry.cues) && entry.cues >= 0)
    .map((entry) => ({ ...entry, comfort: comfortOptions.includes(entry.comfort) ? entry.comfort : '' }))
    .slice(0, 300);
}

export function recordActivity(entry, current) {
  const updated = [entry, ...current.filter(({ id }) => id !== entry.id)].slice(0, 300);
  return { entries: updated, saved: write('activity', updated) };
}
