import { $, observe } from './dashboard.mjs';
import { drawLandmarks } from './pose-overlay.mjs';

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
let last = -1;
function inspect(time) {
  if (video.readyState >= 2 && video.currentTime !== last) {
    last = video.currentTime;
    const points = model.detectForVideo(video, time).landmarks[0];
    drawLandmarks($('landmark-overlay'), points, video);
  }
  frame = requestAnimationFrame(inspect);
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
    const { FilesetResolver, PoseLandmarker } = await import('./vendor/vision.mjs');
    const assets = await FilesetResolver.forVisionTasks(new URL('./vendor/vision', import.meta.url).href);
    const pose = await PoseLandmarker.createFromOptions(assets, {baseOptions: {modelAssetPath: new URL('./assets/pose.task', import.meta.url).href}, runningMode: 'VIDEO', numPoses: 1});
    if (token !== attempt) { pose.close(); return; }
    last = -1;
    model = pose;
    frame = requestAnimationFrame(inspect);
  } catch (error) { stop(); $('sensor-message').textContent = error.message; }
};
observe(state => {
  session = state.session;
  $('camera-button').disabled = !session;
  if (!session) stop();
});
