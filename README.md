# Formline

Formline is an installable web app for posture awareness at a desk. It uses a side view to estimate sustained changes in head position from a comfortable seated reference. It gives an optional tone and an on-screen cue. The movement timer works independently of the camera.

## Run locally

Use Node.js 22 or later.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). **Try demo** simulates a head shift without requesting a camera. Use **Start camera** for a real session. To test on an iPhone, serve the built app from an HTTPS origin, open that link directly in Safari, and choose **Add to Home Screen** from the share menu. Phone camera permissions do not work on a plain HTTP LAN address.

```powershell
npm.cmd test
npm.cmd run build
```

`dist` is the static deployment directory. A static HTTPS host such as Cloudflare Pages can serve it. The app loads its model and runtime from the same host. After a successful load, the service worker can serve the interface offline and reuse model resources the browser has cached.

## Use and limitations

- Put your phone on a stand to your side, around shoulder height, with your ear, shoulder, and hip in frame. Start the camera, sit comfortably, and select **Calibrate**. Recalibrate after moving the phone.
- Formline compares an ear-to-shoulder offset relative to your torso with your reference. This has yet to be validated against clinical measurements. It is intended for awareness and does not assess or treat pain or TMD.
- A loss of tracking pauses cues. Ending the session, switching screens in Formline, or leaving the app releases the camera. Frames are processed in memory and are discarded. Settings, timer state, and activity summaries are saved in the browser. The demo never enters your activity.
- The movement timer provides cues while Formline is open. If the browser suspends the page and a timer expires, the cue appears when you return. This version does not send lock-screen push notifications.

The [MediaPipe Pose Landmarker Lite model card](https://huggingface.co/litert-community/MediaPipe-PoseLandmarker-Lite) documents the model. The build includes MediaPipe's Apache 2.0 license and Manrope's SIL Open Font License. The package dependencies are pinned in the lockfile.

The side-view example at `app/assets/side-view.webp` was created with the built-in ImageGen tool with this prompt.

> Use case: photorealistic-natural. Asset type: camera framing example in the Formline posture awareness app. A candid side-profile photograph of one adult with short dark hair and a pale sage cotton shirt, sitting comfortably in a simple black desk chair while typing at a laptop at home. Person is facing right, head and ear clear, shoulder and entire seated torso to the hip in frame. Show a level, true lateral camera angle taken from about shoulder height. Wide horizontal landscape composition, with the person centered at about 47% frame width and all of the head and hips kept within the central 62% of the image for responsive cropping. The laptop is to the right on the desk. Modern minimal charcoal olive studio wall and a hint of natural window light, subtle film grain, neutral warm undertones and rich soft shadows. The person should be easy to distinguish from the background. Clean and unposed editorial health and wellness photography, anatomically realistic. No text, logos, diagrams, borders, app interface, graphics, or overlaid points.
