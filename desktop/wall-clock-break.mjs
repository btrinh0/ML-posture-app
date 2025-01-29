export function elapsedSinceStart(session, now) {
  return Math.max(0, now - session.started);
}

export function nextDeadline(session) {
  return session.started + session.next_break;
}
