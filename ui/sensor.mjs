import { $, observe } from './dashboard.mjs';

const video = $('video');
let stream, model, frame, session, attempt = 0;
function stop() {
  attempt++;
  cancelAnimationFrame(frame);
  model?.close();
  model = null;
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  $('preview').hidden = true;
  $('camera-button').textContent = 'Start camera';
}
$('camera-button').onclick = async () => {
  if (stream) return stop();
  if (!session) return;
  const token = ++attempt;
  try {
    const device = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    if (token !== attempt || !session) { device.getTracks().forEach(t => t.stop()); return; }
    stream = device;
    video.srcObject = device;
    await video.play();
    $('preview').hidden = false;
    $('camera-button').textContent = 'Stop camera';
  } catch (error) { stop(); $('sensor-message').textContent = error.message; }
};
observe(state => {
  session = state.session;
  $('camera-button').disabled = !session;
  if (!session) stop();
});
