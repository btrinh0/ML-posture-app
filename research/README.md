# Desk activity benchmark

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

The report records leave-one-session-out and leave-one-participant-out scores, per-class F1, confusion matrices, fold results, alert events per observed hour, and warm CPU inference latency. Training uses five-second strides over 20 one-second samples with a single annotation. Evaluation uses every consecutive full window and scores its final second, including activity transitions. Gaps break windows. Split membership uses the session and participant identifiers before any fitting, including CNN normalization. Overlapping exports are deduplicated. Each training fold needs examples of every class.

| Candidate | Inputs and deployment |
| --- | --- |
| Static rules | The latest calibrated CVA-drop and head-offset values, with two possible predictions across the five-class task |
| LightGBM | Mean, spread, per-second slope and latest value for ten channels, plus drift occupancy and trailing dwell. Tree leaves use per-tree signed 8-bit quantization. |
| Temporal 1D CNN | Two temporal convolutions over the six calibrated nose, ear and shoulder coordinates. Conv and linear weights use 8-bit storage with float computation. |
| LightGBM ablation | Trained with slopes, spreads and dwell features held constant to measure the contribution of temporal features |

All scores come from the exported ONNX graphs. False alarms count a sustained predicted slouch after 15 seconds, at most once per episode, with a two-minute cooldown and immediate dismissal assumed in the replay. The denominator is evaluated labeled time. Native CPU latency excludes feature preparation and initial model loading. The desktop separately records end-to-end window inference time and whole-app CPU/RAM. The study compares per-user generalization as well as the five-class and alert outcomes.

Selection ranks candidates meeting a 15 ms p95 budget by session-held-out macro F1, false alarms per hour, then latency. If none meet budget, the report identifies the fastest candidate and the missed target. The winning architecture refits on all available training windows. Import `activity.deskmodel` through **Pose sensor**. For an independent performance claim, evaluate a later collection that played no role in selection.

## Verify the pipeline before collecting data

```powershell
.\.venv\Scripts\python research/benchmark.py --smoke --epochs 3 --out .qa/benchmark
npm.cmd run build
npm.cmd run test:desktop -- --fixtures=.qa/benchmark
```

The smoke run generates six artificial sessions and exercises both split strategies. It emits three fixture-only models and parity cases. The desktop test checks their labels against Python ONNX Runtime. The app’s model import accepts study-trained artifacts. Fixture metrics describe simulated data only.

## Measured desktop replay

On November 23, 2026, the Windows build completed ten-second front-view calibration on a 640 × 480 in-memory replay of Google’s pose reference image. The test kept the OS activity signal active, selected each sampling policy in the desktop UI, warmed up for four seconds and measured eight three-second intervals per policy on an Intel Core i9-12900KF with 24 logical processors, Windows build 26100. Mean CPU sums Electron process percentages. Working set sums the per-process readings and can include shared pages. [Public reference image](https://storage.googleapis.com/mediapipe-assets/pose.jpg)

| Stable front-view replay | Mean CPU | Mean working set |
| --- | ---: | ---: |
| Adaptive monitoring, 1 FPS target | 0.47% | 596 MiB |
| Fixed sampling, 30 FPS target | 2.42% | 588 MiB |

This short replay measures one desktop and one stable pose. Laptop battery use, a physical webcam, mixed desk behaviors and clinical outcomes require separate observations. To repeat it, download the reference JPEG to `.qa/reference-pose.jpg` and add `--pose-image=.qa/reference-pose.jpg` to the desktop smoke command above. The test writes its measurements under `.qa/`.
