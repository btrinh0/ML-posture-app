# Desk activity benchmark

## Explore or reproduce the generated study

The repository ships a four-week simulated study of Aster, Birch and Cedar. The three pseudonyms represent fictional participants. The generator defines varying body proportions, camera orientation, bouts of writing and reading, baseline posture, missing observations and daily discomfort. The labels and diaries were generated together. The classifier sees only ten numeric motion channels. The desktop app exposes the three example dashboards under **Trends → Data source**. [Activity, forecast and outcome results](generated/RESULTS.md)

With the Python environment described below, run these commands from the repository root. Use `study-data/example` as the output directory for a fresh independent reproduction. The first step creates the dated diary and labeled exports. The benchmark fits the models. The replay step scores the four-week histories with the selected graph, and Node produces the report using the app’s SQLite queries.

```powershell
.\.venv\Scripts\python research/generate_study.py --out study-data/example
.\.venv\Scripts\python research/benchmark.py study-data/example/aster-labels.jsonl.gz study-data/example/birch-labels.jsonl.gz study-data/example/cedar-labels.jsonl.gz --out study-data/example
.\.venv\Scripts\python research/generate_study.py --out study-data/example --replay-model study-data/example/activity.deskmodel
node scripts/study-summary.mjs study-data/example
```

The seed is 41723. Each participant contributes 28 sessions of 45 minutes, four labeled ten-minute excerpts and 26 check-ins. Each has one dated intervention. Nine labeled excerpts form the development set. The final excerpt from each participant forms the later-visit test set. The scripts reject overlapping session partitions and mixed human/simulated provenance. Reproduction preserves trajectories and split assignments. Latency measurements depend on the machine.

## Collect a study

Give each participant a separate local profile. In a study session, start the **Side profile** camera, sit comfortably for the 10-second calibration, and enable **labeled capture**. Choose neutral, sustained forward-head slouch, writing, brief reading, or reaching/shifting as the activity changes. Use the labeled buttons or Ctrl + Alt + 1–5. If another application owns a shortcut, the focused window also accepts 1–5.

Collect multiple independent sessions on different days for each participant. Include examples of all five states across visits. Stable blocks of 30–60 seconds give the training pipeline full windows. Keep brief movements brief and label the transitions accurately. Use ordinary comfortable desk activities. A false-alarm prompt during labeled capture can annotate the preceding up to 20 seconds with the corrected activity. Use **Export this profile’s labeled data** for each participant. Exports use randomized participant and session identifiers, elapsed seconds, label segments, override flags and ten numeric channels. The export omits names, wall-clock timestamps, images and symptom logs.

## Train and compare

The training environment is separate from the installed app. Tested with Python 3.13 on Windows x64. Store exports and outputs in `study-data/`, which Git ignores.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python -m pip install -r research/requirements.txt
.\.venv\Scripts\python research/benchmark.py study-data/person1.jsonl study-data/person2.jsonl study-data/person3.jsonl --out study-data/results
```

The report records session-held-out and participant-held-out results, training on one person and testing on each other person, per-class F1, confusion matrices, alert events per observed hour, and warm CPU inference latency. Training uses five-second strides over 20 one-second samples. Neutral, sustained slouch and writing require a homogeneous window. Brief reading and reaching require two consecutive seconds of the new annotation at the window endpoint. Evaluation scores every consecutive full window, including transitions. Gaps break windows. Split membership uses the session and participant identifiers before fitting, including CNN normalization. Overlapping exports are deduplicated. Each training fold needs examples of every class.

| Candidate | Inputs and deployment |
| --- | --- |
| Static rules | The latest calibrated CVA-drop and head-offset values, with two possible predictions across the five-class task |
| LightGBM | Mean, spread, per-second slope and latest value for ten channels, plus drift occupancy and trailing dwell. Tree leaves use per-tree signed 8-bit quantization. |
| Temporal 1D CNN | Two temporal convolutions over the six calibrated nose, ear and shoulder coordinates. Conv and linear weights use 8-bit storage with float computation. |
| LightGBM ablation | Trained with slopes, spreads and dwell features held constant to measure the contribution of temporal features |

All scores come from the exported ONNX graphs. False alarms count a sustained predicted slouch after 15 seconds, at most once per episode, with a two-minute cooldown and immediate dismissal assumed in the replay. The denominator is evaluated labeled time. Native CPU latency excludes feature preparation and initial model loading. The desktop separately records end-to-end window inference time and whole-app CPU/RAM. The study compares per-user generalization as well as the five-class and alert outcomes.

Selection ranks all candidates, including the LightGBM ablation, meeting a 15 ms p95 budget by session-held-out macro F1, false alarms per hour, then latency. If none meet the budget, the report identifies the fastest candidate and the missed target. The winning candidate refits on eligible development windows. A later collection with `partition: "follow_up"` is scored after selection. Import `activity.deskmodel` through **Pose sensor**. The installed app identifies whether the model used simulated sessions or personal exports.

## Verify the pipeline before collecting data

```powershell
.\.venv\Scripts\python research/benchmark.py --smoke --epochs 3 --out .qa/benchmark
npm.cmd run build
npm.cmd run test:desktop -- --fixtures=.qa/benchmark
```

The smoke run generates six artificial sessions and exercises both split strategies. It emits three fixture-only models and parity cases. The desktop test checks their labels against Python ONNX Runtime. The app’s model import accepts study-trained artifacts. Fixture metrics describe simulated data only.

## Measured desktop replay

Deskframe 1.1.0 includes a generated side-view image for an end-to-end camera test. The packaged app calibrates on this image, classifies live 20-second windows, switches sampling policies, measures two known pixel markers, handles OS idle and labeling, and verifies Python/desktop prediction parity. The Windows workflow also installs the setup executable on a clean runner and launches that installed copy. [1.1.0 side-view CPU, memory and inference results](generated/RESULTS.md#measured-windows-desktop-performance)

```powershell
npm.cmd run dist:win
npm.cmd run test:desktop -- release/win-unpacked/Deskframe.exe --side-image=research/generated/side-view.png
```

The command writes `.qa/edge-side-replay.json` and `.qa/onnx-replay.json`. Copy these into a reproduced study output directory before running `node scripts/study-summary.mjs` to include hardware measurements in its report. Add `--verify-only` to exercise the side-view flow without collecting the sampling comparison.

### Earlier camera-only comparison

On November 23, 2026, the Windows build completed ten-second front-view calibration on a 640 × 480 in-memory replay of Google’s pose reference image. The test kept the OS activity signal active, selected each sampling policy in the desktop UI, warmed up for four seconds and measured eight three-second intervals per policy on an Intel Core i9-12900KF with 24 logical processors, Windows build 26100. Mean CPU sums Electron process percentages. Working set sums the per-process readings and can include shared pages. [Public reference image](https://storage.googleapis.com/mediapipe-assets/pose.jpg)

| Stable front-view replay | Mean CPU | Mean working set |
| --- | ---: | ---: |
| Adaptive monitoring, 1 FPS target | 0.47% | 596 MiB |
| Fixed sampling, 30 FPS target | 2.42% | 588 MiB |

This short replay measures one desktop and one stable pose. Laptop battery use, a physical webcam, mixed desk behaviors and clinical outcomes require separate observations. To repeat it, download the reference JPEG to `.qa/reference-pose.jpg` and add `--pose-image=.qa/reference-pose.jpg` to the desktop smoke command above. The test writes its measurements under `.qa/`.

On the same machine, the packaged desktop app ran 100 warm ONNX windows per fixture model. The p95 was approximately 0.20 ms for rules, LightGBM and the CNN at the renderer timer’s resolution. Each timing starts with an available 20-second window of pose features and includes input preparation and scoring. All three models matched their Python CPU predictions on ten parity windows each.
