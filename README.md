# Deskframe

Deskframe is a local-first Windows desktop companion for study sessions. Start with a camera-free timer, desk setup and daily discomfort check-in. Add the camera when you want calibrated posture feedback, or turn on labeled capture to build a personal activity dataset. The app runs from the system tray.

## Install

Run the Windows x64 installer `Deskframe-Setup-1.0.0.exe`. It installs for the current user and includes the offline sensor, SQLite and the ONNX CPU runtime. The current installer is unsigned. Completed **Windows desktop** workflow runs offer the installer in the **Deskframe-Windows-x64** artifact. **Desk setup → Desktop preferences** controls launch at sign-in. Use **Quit Deskframe** in the tray menu to exit. [Windows builds](https://github.com/btrinh0/test/actions/workflows/windows.yml)

## Run from source

Use Node.js 24 or later and run the following commands in the repository.

```powershell
npm.cmd ci
npm.cmd start
```

Run `npm.cmd test` for the domain tests, then `npm.cmd run build` and `npm.cmd run test:desktop` for a native smoke test in an isolated profile. `npm.cmd run dist:win` builds the installer in `release/`. Dependency installation and the first development build use the network.

## Using the companion

1. Open **Desk setup**, answer three workstation questions, and choose a reminder interval of 25–40 active minutes. Each adjustment corresponds to a question. [OSHA workstation checklist](https://www.osha.gov/etools/computer-workstations/checklists/evaluation)
2. Start a session in **Study desk**. After 60 seconds of system inactivity the clock pauses. A break can be completed, snoozed for five active minutes, or skipped. Short movement breaks and changes of position are discussed in the [OSHA work process guide](https://www.osha.gov/etools/computer-workstations/work-process).
3. Log jaw, neck and upper-back discomfort once per day. Saving again edits that day’s entry. Use a separate local profile for each person.

The movement library offers optional gentle movements for desk breaks. Its references include [University Hospitals Sussex](https://www.uhsussex.nhs.uk/resources/self-treatment-of-acute-neck-pain-2/) and [Leeds Teaching Hospitals](https://www.leedsth.nhs.uk/patients/resources/shoulder-exercises/).

## Optional camera sensing

Start a study session, open **Pose sensor**, choose a view, and start the camera. Sit comfortably for ten continuous seconds. Missing or unstable landmarks restart calibration. Recalibrate after moving the camera or chair.

| View | Measurements |
| --- | --- |
| Side profile | The ear–shoulder inclination in a torso-relative coordinate system estimates a CVA-like angle. Forward head offset and shoulder displacement relative to the hip use torso-length units. Shoulder displacement includes torso lean. |
| Front facing | Signed shoulder elevation relative to the baseline uses the height difference divided by shoulder width. Positive values indicate a higher anatomical left shoulder. |

The side-view moment illustration uses a 10 lbf head weight, a nominal 0.50 m torso, and the normalized forward offset. Dividing the moment by a reference arm of 0.10 m yields an equivalent lever force in lbf. Individual head mass, muscle forces and joint loads are unmeasured. The camera proxies and alert thresholds are engineering measures for within-setup tracking. Clinical CVA measurement uses the tragus, the C7 landmark and a horizontal reference. [CVA validation study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7559098/)

The local MediaPipe sensor polls at 1 FPS during stable monitoring, targets 12 FPS during calibration or verification, and pauses inference when the OS is idle. **Fixed 30 FPS experiment** enables a comparison run. With valid tracking, a sustained drift cue replaces the scheduled timer cue. Tracking loss brings back timer reminders. [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

## Training and trends

The initial install uses static posture rules. The study tools compare those rules, LightGBM and a PyTorch 1D CNN using 20-second windows and held-out sessions and participants. Import the selected local model to enable ONNX classification. The repository includes reproducible fixture checks. Real-user F1, alert rates and symptom outcomes require participant recordings. [Study and benchmark instructions](research/README.md)

**Trends** shows weekly and daily CVA proxies, neutral tracked time, discomfort, completed drills, week-over-week changes, and a time-of-day heatmap. Percentages use observed seconds. Weekly correlations describe associations between symptoms and measurements from the same day. The most frequently observed weekly drift pattern influences the next movement suggestion. The fatigue forecaster needs 14 observed days, three qualifying historical sessions, and a live side-view classifier. It blends recent and personal historical drift slopes and looks for an accelerating loss approaching the cue threshold within three minutes.

## Local data

The installed app keeps `deskframe.sqlite` under its per-user Electron data directory on Windows. SQLite stores settings, daily scores, sessions, drill responses, and calibrated numeric measurements. The OS supplies idle duration. Raw keystrokes, video, audio and images are never logged. Ordinary camera sessions store summary metrics only. Opt-in labeled capture adds calibrated numeric vectors and allows a false-alarm correction of the preceding window. An explicit **Export** action writes a pseudonymous file to a location you choose. Local profiles share the Windows account’s file access.

The installer bundles the versioned [Google pose sensor](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task), [ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/) and Inter. The build verifies the sensor SHA-256 and packages the third-party license texts.
