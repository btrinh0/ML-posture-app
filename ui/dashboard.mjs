import { deskQuestions, drills } from './companion.mjs';

export const $ = (id) => document.getElementById(id);
export function node(tag, text, cls) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
}
for (const drill of Object.values(drills)) {
  $('drill-library').append(node('h3', drill.title), node('p', drill.text, 'muted'));
}
let state, formKey, feedbackTimer;
const renderers = new Set();
export function observe(fn) {
  renderers.add(fn);
  if (state) fn(state);
}
export function feedback(text) {
  $('feedback').textContent = text;
  $('feedback').hidden = false;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    $('feedback').hidden = true;
  }, 6500);
}
export async function act(name, value, message) {
  try {
    render(await window.desk.action(name, value));
    if (message) feedback(message);
    return true;
  } catch (err) {
    feedback(err.message.replace(/^Error invoking remote method .+?Error: /, ''));
    return false;
  }
}
export function openPage(id) {
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== id;
  for (const btn of document.querySelectorAll('[data-page]')) {
    if (btn.dataset.page === id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  window.dispatchEvent(new CustomEvent('desk-page', { detail: id }));
}
export const duration = (ms) => {
  const sec = Math.floor(ms / 1000);
  return [Math.floor(sec / 60), sec % 60].map((v) => String(v).padStart(2, '0')).join(':');
};
function selectField(parent, id, title, choices) {
  const label = node('label', title),
    select = node('select');
  select.id = id;
  select.required = true;
  select.add(new Option('Choose…', ''));
  choices.forEach((v, i) => select.add(new Option(v, i)));
  label.append(select);
  parent.append(label);
}
deskQuestions.forEach((q) => selectField($('questions'), q.key, q.title, q.choices));
for (const [key, title] of [
  ['jaw', 'Jaw tension'],
  ['neck', 'Neck stiffness'],
  ['back', 'Upper-back soreness'],
]) {
  selectField(
    $('scores'),
    key,
    title,
    Array.from({ length: 11 }, (_, i) => String(i)),
  );
}
function render(next) {
  if (!next) return;
  state = next;
  const { profile, session, prompt } = state;
  const form = JSON.stringify([profile, state.profiles, state.day, state.symptoms, state.autoStart]);
  if (form !== formKey) {
    formKey = form;
    $('profiles').replaceChildren(
      ...state.profiles.map((p) => new Option(p.alias, p.id, false, p.id === profile.id)),
    );
    deskQuestions.forEach(({ key }) => {
      $(key).value = profile.setup?.[key] ?? '';
    });
    ['jaw', 'neck', 'back'].forEach((k) => {
      $(k).value = state.symptoms?.[k] ?? '';
    });
    $('interval').value = profile.interval_min;
    $('adjustments').hidden = !state.setupResult;
    $('advice').replaceChildren(
      ...(state.setupResult?.advice.length
        ? state.setupResult.advice
        : ['All three setup checks are supported.']
      ).map((t) => node('p', t)),
    );
    $('desk-status').textContent = state.setupResult
      ? state.setupResult.score + ' of 3 desk checks supported'
      : 'Desk setup incomplete.';
    $('date').textContent = new Date(state.day + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }
  $('session-button').textContent = session ? 'End session' : 'Start session';
  $('session-status').textContent = !session ? 'Ready' : state.idle ? 'Paused while idle' : 'In progress';
  $('clock').textContent = duration(session?.active_ms ?? 0);
  const historyKey = JSON.stringify(state.history);
  if ($('history').dataset.key !== historyKey) {
    $('history').dataset.key = historyKey;
    $('history').replaceChildren(
      ...(state.history.length
        ? state.history.map((s) => {
            const row = node('div', undefined, 'row');
            row.append(
              node(
                'span',
                new Date(s.started).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              ),
              node('strong', duration(s.active_ms) + ' active'),
            );
            return row;
          })
        : [node('p', 'No completed sessions yet.', 'muted')]),
    );
  }
  for (const fn of renderers) fn(state);
}
document
  .querySelectorAll('[data-page],[data-open]')
  .forEach((b) => (b.onclick = () => openPage(b.dataset.page || b.dataset.open)));
$('session-button').onclick = () => act(state.session ? 'end' : 'start');
$('profiles').onchange = (e) => act('profile', Number(e.target.value));
$('add-profile').onclick = () => $('profile-dialog').showModal();
$('cancel-profile').onclick = () => $('profile-dialog').close();
$('profile-form').onsubmit = async (e) => {
  e.preventDefault();
  if (await act('addProfile', $('alias').value)) {
    $('profile-dialog').close();
    $('alias').value = '';
  }
};
$('symptoms').onsubmit = (e) => {
  e.preventDefault();
  act(
    'checkIn',
    Object.fromEntries(['jaw', 'neck', 'back'].map((k) => [k, Number($(k).value)])),
    'Today’s check-in is saved.',
  );
};
$('setup-form').onsubmit = (e) => {
  e.preventDefault();
  act(
    'setup',
    {
      answers: Object.fromEntries(deskQuestions.map(({ key }) => [key, Number($(key).value)])),
      interval: Number($('interval').value),
    },
    'Desk setup saved.',
  );
};
window.desk.onChange(render);
render(await window.desk.state());
