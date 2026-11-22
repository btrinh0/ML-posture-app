let preferCpu = false;

async function createLandmarker(signal) {
  const { FilesetResolver, PoseLandmarker } = await import('./vendor/vision_bundle.mjs');
  signal.throwIfAborted();
  const files = await FilesetResolver.forVisionTasks(new URL('./vendor/wasm', import.meta.url).href);
  signal.throwIfAborted();

  const create = (delegate) => PoseLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: new URL('./assets/pose_landmarker_lite.task', import.meta.url).href,
      delegate,
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  if (preferCpu) return create('CPU');
  try {
    return await create('GPU');
  } catch {
    signal.throwIfAborted();
    preferCpu = true;
    return create('CPU');
  }
}

export function requestCamera(facingMode) {
  if (!window.isSecureContext) {
    throw new Error('Open Formline over HTTPS to use the camera on your phone.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('The camera is unavailable here. Open this link directly in Safari.');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 20, max: 30 },
    },
  });
}

export function cameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Allow camera access in your browser’s site settings, then try again.';
    case 'NotFoundError':
      return 'No camera was found. You can still try the demo or use the break timer.';
    case 'NotReadableError':
      return 'The camera is busy. Close other apps using it, then try again.';
    default:
      return error instanceof Error ? error.message : 'Camera tracking could not start. Try again.';
  }
}

export async function runCamera({ video, request, signal, onPreview, onReady, onFrame, onError }) {
  let stream;
  let landmarker;
  let animation = 0;
  let ended = [];

  function close() {
    cancelAnimationFrame(animation);
    for (const [track, listener] of ended) track.removeEventListener('ended', listener);
    ended = [];
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
    stream?.getTracks().forEach((track) => track.stop());
    landmarker?.close();
    landmarker = null;
  }
  signal.addEventListener('abort', close, { once: true });

  try {
    stream = await request;
    signal.throwIfAborted();
    ended = stream.getVideoTracks().map((track) => {
      const listener = () => onError('The camera disconnected. Start a new session to reconnect.');
      track.addEventListener('ended', listener);
      return [track, listener];
    });
    video.srcObject = stream;
    onPreview();
    await video.play();
    signal.throwIfAborted();
    try {
      landmarker = await createLandmarker(signal);
    } catch (error) {
      console.warn('Formline could not load pose tracking.', error);
      throw new Error('Pose tracking could not load. Check your connection and try again.');
    }
    signal.throwIfAborted();
    onReady();

    let lastRun = -Infinity;
    let lastVideoTime = -1;
    let frameInterval = 125;
    function tick(now) {
      if (signal.aborted) return;
      if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime
        && now - lastRun >= frameInterval) {
        lastVideoTime = video.currentTime;
        lastRun = now;
        let landmarks;
        try {
          const start = performance.now();
          landmarks = landmarker.detectForVideo(video, now).landmarks[0];
          frameInterval = Math.max(125, Math.min(500, (performance.now() - start) * 2.5));
        } catch (error) {
          preferCpu = true;
          console.warn('Formline pose tracking stopped.', error);
          onError('Tracking stopped. Start the camera again to reconnect.');
          return;
        }
        onFrame(landmarks, video.videoWidth, video.videoHeight, now);
      } else if (now - lastRun > 900 && Number.isFinite(lastRun)) {
        onFrame(null, video.videoWidth, video.videoHeight, now);
        lastRun = now;
      }
      if (!signal.aborted) animation = requestAnimationFrame(tick);
    }
    animation = requestAnimationFrame(tick);
  } catch (error) {
    close();
    if (!signal.aborted) onError(cameraError(error));
  }
}
