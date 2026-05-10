import { $, act, feedback, node, observe } from './dashboard.mjs';
import { drills } from './companion.mjs';

const display = (v, unit = '', digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) + unit : '—');
function table(head, data) {
  const t = node('table'),
    tr = node('tr'),
    thead = node('thead'),
    tbody = node('tbody');
  for (const text of head) {
    const cell = node('th', text);
    cell.scope = 'col';
    tr.append(cell);
  }
  thead.append(tr);
  t.append(thead, tbody);
  for (const row of data) {
    const r = node('tr');
    row.forEach((v, i) => {
      const cell = node(i === 0 ? 'th' : 'td');
      if (i === 0) cell.scope = 'row';
      if (typeof v === 'object') {
        cell.textContent = v.text;
        cell.title = v.title;
        cell.className = v.cls;
      } else cell.textContent = v;
      r.append(cell);
    });
    tbody.append(r);
  }
  return t;
}
let report,
  version = 0,
  profile,
  last = 0,
  state,
  stateKey;
async function refresh() {
  const id = ++version;
  try {
    const source = 'personal';
    const days = 28;
    const next = await window.desk.report(days);
    report = next;
    last = Date.now();
    render();
  } catch (err) {
    feedback(err.message);
  }
}
function plot() {}
function render() {
  const r = report;
  plot();
  $('pattern').replaceChildren(
    ...(r.pattern
      ? [
          node('h3', r.pattern.title),
          node(
            'p',
            drills[r.pattern.drill].title + ' · ' + r.pattern.seconds + ' observed seconds this week.',
            'muted',
          ),
        ]
      : [node('p', 'More tracking is needed to suggest a drill.', 'muted')]),
  );
  $('forecast-state').textContent =
    r.history.slope === null
      ? r.history.days +
        ' observed days · ' +
        r.history.sessions +
        ' qualifying sessions. Forecasts need 14 days, 3 sessions and a classifier.'
      : 'History ready. During a classified session, drift can trigger a break up to three minutes early.';
  $('responses').replaceChildren(
    r.prompts.length
      ? table(
          ['Reminder', 'Response', 'Count'],
          r.prompts.map((p) => [p.kind.replace('_', ' '), p.outcome.replace('_', ' '), String(p.n)]),
        )
      : node('p', 'No break responses yet.', 'muted'),
  );
}
window.addEventListener('desk-page', (e) => {
  if (e.detail === 'trends') void refresh();
});
observe((next) => {
  const key = JSON.stringify([next.day, next.symptoms, next.session?.id, next.completed, next.prompt?.id]);
  const changed = profile !== next.profile.id || key !== stateKey;
  state = next;
  profile = state.profile.id;
  stateKey = key;
  if (!$('trends').hidden && (changed || Date.now() - last > 60_000)) {
    last = Date.now();
    void refresh();
  }
});
