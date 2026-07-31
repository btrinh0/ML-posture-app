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
let examples;
async function exampleReports() {
  if (!examples) {
    const response = await fetch('./assets/dashboard.json');
    if (!response.ok) throw new Error('The bundled study could not be opened.');
    examples = await response.json();
  }
  return examples;
}
async function refresh() {
  const id = ++version;
  try {
    const source = $('report-source').value;
    const days = Number($('range').value);
    const next = source === 'personal' ? await window.desk.report(days) : (await exampleReports()).reports[source][days];
    if (id !== version) return;
    report = next;
    $('change-form').hidden = source !== 'personal';
    $('report-context').textContent = source === 'personal'
      ? 'Gaps indicate missing measurements.'
      : 'Simulated study · ' + $('report-source').selectedOptions[0].text.split(' · ')[0] + ' · ' + examples.start + ' to ' + examples.end + '. Check-ins and desk changes are fictional.';
    last = Date.now();
    render();
  } catch (err) {
    feedback(err.message);
  }
}
function plot() {
  if (!report || $('trends').hidden) return;
  const canvas = $('trend-plot'),
    metric = $('plot-metric').value,
    pain = $('plot-pain').value;
  const weekly = $('plot-group').value === 'weekly';
  const points = weekly ? report.weeks.map((w) => ({ ...w, day: w.end })) : report.series;
  canvas.setAttribute('aria-label', (weekly ? 'Weekly' : 'Daily') + ' posture and discomfort trajectories');
  const any = points.some((p) => p[metric] !== null || p[pain] !== null);
  $('plot-empty').hidden = any;
  canvas.hidden = !any;
  if (!any) return;
  const width = Math.max(300, canvas.clientWidth),
    height = 238,
    dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.font = '11px Inter, sans-serif';
  const left = 42,
    right = width - 16;
  const x = (i) =>
    points.length > 1 ? left + ((right - left) * i) / (points.length - 1) : (left + right) / 2;
  function line(key, title, top, bottom, range, color) {
    c.textAlign = 'left';
    c.fillStyle = color;
    c.fillText(title, left, top - 9);
    for (const frac of [0, 0.5, 1]) {
      const y = bottom - frac * (bottom - top);
      c.strokeStyle = '#dce1d7';
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(right, y);
      c.stroke();
      c.fillStyle = '#506059';
      c.textAlign = 'right';
      c.fillText(String(Math.round(range[0] + frac * (range[1] - range[0]))), left - 7, y + 3);
    }
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 2;
    let previous = null;
    points.forEach((p, i) => {
      if (p[key] === null) {
        previous = null;
        return;
      }
      const here = [x(i), bottom - ((p[key] - range[0]) / (range[1] - range[0])) * (bottom - top)];
      if (previous) {
        c.beginPath();
        c.moveTo(...previous);
        c.lineTo(...here);
        c.stroke();
      }
      c.beginPath();
      c.arc(...here, 2.7, 0, Math.PI * 2);
      c.fill();
      previous = here;
    });
    c.lineWidth = 1;
  }
  const values = points.map((p) => p[metric]).filter(Number.isFinite);
  const low = values.length ? Math.floor((Math.min(...values) - 2) / 5) * 5 : 0;
  const high = values.length ? Math.ceil((Math.max(...values) + 2) / 5) * 5 : 90;
  line(
    metric,
    $('plot-metric').selectedOptions[0].text,
    25,
    89,
    metric === 'neutral_pct' ? [0, 100] : [low, high],
    '#245b40',
  );
  line(pain, $('plot-pain').selectedOptions[0].text + ' (0–10)', 138, 202, [0, 10], '#935d39');
  c.fillStyle = '#52615a';
  c.textAlign = 'left';
  c.fillText(points[0].day, left, 228);
  c.textAlign = 'right';
  c.fillText(points.at(-1).day, right, 228);
}
function render() {
  const r = report;
  plot();
  $('weekly').replaceChildren(
    table(
      [
        'Week ending',
        'Tracked',
        'CVA proxy',
        'Tragus–C7 CVA',
        'Δ proxy',
        'Neutral',
        'Discomfort',
        'Δ discomfort',
        'Drills done',
        'Pairs',
        'r · CVA',
        'r · neutral',
        'Marker pairs',
        'r · marker CVA',
        'Δ marker CVA',
      ],
      r.weeks.map((w) => [
        w.end,
        display(w.seconds / 60, ' min'),
        display(w.cva, '°'),
        display(w.marker_cva, '°'),
        display(w.cva_change, '°'),
        display(w.neutral_pct, '%'),
        display(w.pain),
        display(w.pain_change),
        String(w.completed),
        String(w.paired),
        display(w.r_cva, '', 2),
        display(w.r_neutral, '', 2),
        String(w.marker_paired),
        display(w.r_marker, '', 2),
        display(w.marker_change, '°'),
      ]),
    ),
  );
  const details = r.changes.map(({ title, day, before, after, inProgress }) => {
    const section = node('section');
    section.append(node('h3', title), node('p', day + (inProgress ? ' · Follow-up in progress' : ''), 'hint'));
    section.append(table(['Measure', before.first + ' – ' + before.last, after.first + ' – ' + after.last, 'Change'],
      [['CVA proxy', 'cva', '°'], ['Tragus–C7 CVA', 'marker_cva', '°'], ['Neutral tracked time', 'neutral_pct', '%'], ['Mean discomfort', 'pain', ''],
       ['Jaw tension', 'jaw', ''], ['Neck stiffness', 'neck', ''], ['Upper-back soreness', 'back', ''],
       ['Completed drills', 'completed', ''], ['Days with tracking', 'tracked_days', ''], ['Days with check-ins', 'logged_days', '']]
        .map(([label, key, unit], index) => {
          const a = before[key], b = after[key];
          const delta = Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
          return [label, display(a, unit, index >= 7 ? 0 : 1), display(b, unit, index >= 7 ? 0 : 1),
            display(delta, key === 'neutral_pct' ? ' pp' : unit, index >= 7 ? 0 : 1)];
        })));
    return section;
  });
  $('change-results').replaceChildren(...(details.length ? details : [node('p', 'No recorded changes in this period.', 'hint')]));
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
  const source = $('report-source').value;
  const check = examples?.controlled?.[source];
  $('example-forecast').hidden = !check;
  if (check) {
    const lead = check.progressive.lead_seconds;
    $('example-forecast').textContent = examples.forecast[source].issued + ' nudges in four weeks. The steady test had ' + check.stable.nudges.length +
      '. ' + (lead === null ? 'The drift test had no warning within three minutes.' : 'The drift test gave ' + lead + ' seconds of warning.');
  }
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const buckets = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
  const forecasts = $('heat-type').value === 'forecast';
  $('heat-caption').textContent = forecasts
    ? 'Number of early movement reminders triggered by the personal drift forecast.'
    : 'Percentage of tracked side-view seconds with a CVA drop of 7° or more.';
  $('heat').replaceChildren(
    table(
      ['Day', ...buckets],
      [1, 2, 3, 4, 5, 6, 0].map((d) => [
        names[d],
        ...buckets.map((_, i) => {
          const b = r.heat.find((h) => h.weekday === d && h.block === i);
          if (forecasts && b) {
            const n = r.forecastHeat.find((h) => h.weekday === d && h.block === i)?.n ?? 0;
            return { text: String(n), title: n + ' forecast nudges', cls: 'heat h' + Math.min(3, n) };
          }
          return b
            ? {
                text: display(b.drift, '%', 0),
                title: b.seconds + ' tracked seconds',
                cls: 'heat h' + Math.min(3, Math.floor(b.drift / 25)),
              }
            : { text: '—', title: 'No tracked seconds', cls: 'missing' };
        }),
      ]),
    ),
  );
  $('responses').replaceChildren(
    r.prompts.length
      ? table(
          ['Reminder', 'Response', 'Count'],
          r.prompts.map((p) => [p.kind.replace('_', ' '), p.outcome.replace('_', ' '), String(p.n)]),
        )
      : node('p', 'No break responses yet.', 'muted'),
  );
  $('performance').replaceChildren(
    r.performance.length
      ? table(
          ['Sampling', 'Observations', 'Mean CPU', 'Working set', 'Timed windows', 'Mean ONNX window'],
          r.performance.map((p) => [
            p.policy,
            String(p.n),
            display(p.cpu, '%'),
            display(p.ram, ' MiB', 0),
            String(p.timed_windows),
            display(p.latency, ' ms', 2),
          ]),
        )
      : node('p', 'Start a session to measure performance.', 'muted'),
  );
}
$('range').onchange = refresh;
$('report-source').onchange = refresh;
$('change-form').onsubmit = async (event) => {
  event.preventDefault();
  if ($('report-source').value !== 'personal') return;
  if (await act('markChange', { day: $('change-date').value, title: $('change-title').value }, 'Change recorded.')) {
    $('change-title').value = '';
    await refresh();
  }
};
$('heat-type').onchange = () => {
  if (report) render();
};
$('plot-group').onchange = $('plot-metric').onchange = $('plot-pain').onchange = plot;
window.addEventListener('resize', plot);
window.addEventListener('desk-page', (e) => {
  if (e.detail === 'trends') void refresh();
});
observe((next) => {
  const key = JSON.stringify([next.day, next.symptoms, next.session?.id, next.completed, next.prompt?.id]);
  const changed = profile !== next.profile.id || key !== stateKey;
  state = next;
  $('change-date').max = next.day;
  if (!$('change-date').value) $('change-date').value = next.day;
  profile = state.profile.id;
  stateKey = key;
  if (!$('trends').hidden && (changed || Date.now() - last > 60_000)) {
    last = Date.now();
    void refresh();
  }
});
