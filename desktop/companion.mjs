export const deskQuestions = [
  { key: 'screen', title: 'Monitor height', choices: ['Top at or just below my eyes', 'Too high', 'Too low'],
    advice: ['', 'Lower the screen until the top is near eye level.', 'Raise the screen so you can read with your head comfortably upright.'] },
  { key: 'reach', title: 'Keyboard reach', choices: ['Elbows rest close to my sides', 'I reach forward', 'My shoulders lift'],
    advice: ['', 'Bring the keyboard and mouse closer to your chair.', 'Lower the input surface or adjust your chair so your shoulders can relax.'] },
  { key: 'seat', title: 'Chair support', choices: ['Back and feet supported', 'Lower back unsupported', 'Feet unsupported'],
    advice: ['', 'Adjust the backrest to support your lower back.', 'Lower the seat or place a stable footrest underneath your desk.'] },
];

export const drills = {
  walk: { title: 'Stand and walk', text: 'Leave the desk for a comfortable walk. Return when you feel ready.' },
  chin: { title: 'Gentle chin tuck', text: 'Look straight ahead. Gently draw your chin back, keeping your eyes level, then release.' },
  back: { title: 'Seated upper-back extension', text: 'Sit against a supportive chair. Gently lift your chest and ease your upper back over the backrest, then return.' },
  shoulders: { title: 'Shoulder-blade squeeze', text: 'Relax your shoulders. Gently bring your shoulder blades toward each other, then release.' },
};

export function deskResult(answers) {
  const advice = deskQuestions.flatMap(({ key, advice }) => {
    const choice = answers?.[key];
    if (!Number.isInteger(choice) || choice < 0 || choice >= advice.length) throw new Error('Answer each desk question.');
    return choice === 0 ? [] : [advice[choice]];
  });
  return { score: deskQuestions.length - advice.length, advice };
}

export function localDay(at = Date.now()) {
  const d = new Date(at);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

export function dayBefore(day, count) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() - count);
  return localDay(d);
}
