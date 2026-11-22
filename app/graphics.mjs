const icons = {
  activity: 'M3 16h3l4-9 4 12 3-5h4',
  bars: 'M4 19V7m5 12v-5m5 5V5m5 14v-8',
  video: 'M15 10l4.6-2.8a.9.9 0 0 1 1.4.8v8a.9.9 0 0 1-1.4.8L15 14M5 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
  phone: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 15h2',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3m-11 0h12a1.8 1.8 0 0 1 2 2v6a1.8 1.8 0 0 1-2 2H6a1.8 1.8 0 0 1-2-2v-6a1.8 1.8 0 0 1 2-2Zm6 4v2',
  play: 'm9 5 11 7-11 7V5Z',
  pause: 'M9 5v14m6-14v14',
  stop: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  focus: 'M8 4H6a2 2 0 0 0-2 2v2m12-4h2a2 2 0 0 1 2 2v2m0 8v2a2 2 0 0 1-2 2h-2m-8 0H6a2 2 0 0 1-2-2v-2m8-6v4m-2-2h4',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 3 6 3 8H3c0-2 3-2 3-8m4 11a2 2 0 0 0 4 0',
  check: 'm5 12 4 4L19 6',
  side: 'M8 20v-4a4 4 0 0 1 4-4h3l3-3-3-2a4.5 4.5 0 1 0-6 4m4 9v-3h4m-5-10h.01',
  body: 'M13 12c-3 0-4 2-5 5m6-5 2 4h4m-8-4-1 5 4 3m-2-11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  stretch: 'M12 13v4m-3 4 3-4 3 4M4 7l4 4h8l4-4M14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  x: 'm6 6 12 12M18 6 6 18',
  share: 'M12 15V3m-4 4 4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1',
  volume: 'M11 5 6 9H3v6h3l5 4V5Zm4 4a4 4 0 0 1 0 6m2.8-9a8 8 0 0 1 0 12',
  chevron: 'm8 10 4 4 4-4',
};

export function setIcon(element, name) {
  if (element.dataset.renderedIcon === name) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', icons[name] ?? icons.activity);
  svg.append(path);
  element.replaceChildren(svg);
  element.dataset.renderedIcon = name;
}

export function paintTracking(canvas, points, width, height, highlight) {
  const context = canvas.getContext('2d');
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!points) return;
  const color = highlight ? '#ffca86' : '#d1f68c';
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.setLineDash([width / 95, width / 130]);
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, width / 300);
  context.beginPath();
  points.forEach(({ x, y }, index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.stroke();
  context.setLineDash([]);
  for (const { x, y } of points) {
    context.beginPath();
    context.arc(x, y, Math.max(3, width / 117), 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = '#192d24';
    context.stroke();
  }
}

export function demoLandmarks(drift) {
  const point = (x, y) => ({ x, y, visibility: 1, presence: 1 });
  const landmarks = [];
  landmarks[0] = point(0.445 + drift, 0.257);
  landmarks[7] = point(0.394 + drift, 0.25);
  landmarks[11] = point(0.384, 0.425);
  landmarks[23] = point(0.384, 0.78);
  return landmarks;
}

export function paintDemo(canvas, width, height, drift) {
  const context = canvas.getContext('2d');
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  const fill = context.createLinearGradient(0, 0, width, height);
  fill.addColorStop(0, '#193128');
  fill.addColorStop(1, '#0f211a');
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
  context.save();
  context.scale(width / 720, height / 440);
  context.strokeStyle = '#c9ef8621';
  context.lineWidth = 1;
  for (let x = 18; x < 720; x += 28) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 440);
    context.stroke();
  }
  for (let y = 10; y < 440; y += 28) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(720, y);
    context.stroke();
  }

  context.strokeStyle = '#628370';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(210, 225);
  context.lineTo(229, 365);
  context.lineTo(383, 365);
  context.moveTo(411, 274);
  context.lineTo(594, 274);
  context.lineTo(594, 406);
  context.moveTo(223, 365);
  context.lineTo(223, 401);
  context.moveTo(372, 365);
  context.lineTo(372, 401);
  context.moveTo(496, 263);
  context.lineTo(548, 263);
  context.lineTo(571, 193);
  context.stroke();

  const e = (0.394 + drift) * 720;
  context.fillStyle = '#625844';
  context.beginPath();
  context.moveTo(252, 170);
  context.bezierCurveTo(304, 153, 316, 210, 315, 254);
  context.lineTo(313, 318);
  context.quadraticCurveTo(354, 320, 390, 345);
  context.lineTo(375, 358);
  context.lineTo(258, 358);
  context.quadraticCurveTo(231, 258, 252, 170);
  context.fill();
  context.strokeStyle = '#a89168';
  context.lineWidth = 20;
  context.beginPath();
  context.moveTo(298, 198);
  context.quadraticCurveTo(314, 255, 341, 256);
  context.lineTo(458, 261);
  context.stroke();
  context.beginPath();
  context.moveTo(267, 184);
  context.lineTo(e - 4, 135);
  context.stroke();
  context.fillStyle = '#beaa7c';
  context.beginPath();
  context.ellipse(e + 7, 109, 34, 45, -0.1, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(e + 31, 97);
  context.lineTo(e + 45, 114);
  context.lineTo(e + 27, 122);
  context.fill();
  context.restore();
}
