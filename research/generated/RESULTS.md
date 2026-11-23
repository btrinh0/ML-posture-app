# Four-week simulated desk study

Aster, Birch and Cedar are fictional. The generator created 84 desk sessions of 45 minutes, dated 2026-10-26 through 2026-11-22. Each profile has 26 symptom check-ins, one planned change and four labeled ten-minute visits. Movement, reported discomfort and adherence are simulated. The F1 scores, alert counts and inference timings below were computed by running the software.

## Activity recognition

Nine visits were used for model selection. The selected LightGBM (mean and latest) graph was fitted on eligible windows from those visits. The three architectures and the LightGBM feature ablation were then evaluated on three later visits. Each 20-second window predicts its final second. The alert replay requires 15 seconds of sustained predicted slouch and a two-minute cooldown.

### Held-out development sessions

| Model | Macro-F1 | Scored hours | Alerts | False alerts | False alerts/hour | Native CPU p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Static rules | 0.297 | 1.421 | 32 | 20 | 14.07 | 0.035 |
| LightGBM (full features) | 0.676 | 1.421 | 24 | 1 | 0.70 | 0.059 |
| Temporal 1D CNN | 0.547 | 1.421 | 22 | 0 | 0.00 | 0.048 |
| LightGBM (mean and latest) | 0.725 | 1.421 | 22 | 0 | 0.00 | 0.065 |

### Held-out participants

| Model | Macro-F1 | Scored hours | Alerts | False alerts | False alerts/hour | Native CPU p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Static rules | 0.297 | 1.421 | 32 | 20 | 14.07 | 0.035 |
| LightGBM (full features) | 0.659 | 1.421 | 24 | 0 | 0.00 | 0.061 |
| Temporal 1D CNN | 0.525 | 1.421 | 22 | 0 | 0.00 | 0.050 |
| LightGBM (mean and latest) | 0.692 | 1.421 | 22 | 0 | 0.00 | 0.060 |

### Later visits reserved before training

| Model | Macro-F1 | Scored hours | Alerts | False alerts | False alerts/hour | Native CPU p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Static rules | 0.304 | 0.484 | 9 | 3 | 6.20 | 0.039 |
| LightGBM (full features) | 0.706 | 0.484 | 10 | 0 | 0.00 | 0.057 |
| Temporal 1D CNN | 0.532 | 0.484 | 10 | 0 | 0.00 | 0.049 |
| LightGBM (mean and latest) | 0.697 | 0.484 | 10 | 0 | 0.00 | 0.075 |

### Train on one participant and test on another

| Train | Test | Rules macro-F1 | LightGBM full macro-F1 | LightGBM mean/latest macro-F1 | CNN macro-F1 |
| --- | --- | --- | --- | --- | --- |
| aster | birch | 0.277 | 0.619 | 0.615 | 0.479 |
| aster | cedar | 0.310 | 0.623 | 0.694 | 0.491 |
| birch | aster | 0.304 | 0.693 | 0.646 | 0.281 |
| birch | cedar | 0.310 | 0.703 | 0.734 | 0.397 |
| cedar | aster | 0.304 | 0.621 | 0.611 | 0.478 |
| cedar | birch | 0.277 | 0.692 | 0.721 | 0.535 |

### Which activities were recognized on the later visits?

| Model | neutral | slouch | writing | reading | reaching |
| --- | --- | --- | --- | --- | --- |
| Static rules | 0.896 | 0.626 | 0.000 | 0.000 | 0.000 |
| LightGBM (full features) | 0.965 | 0.824 | 0.663 | 0.455 | 0.623 |
| Temporal 1D CNN | 0.804 | 0.782 | 0.689 | 0.161 | 0.225 |
| LightGBM (mean and latest) | 0.982 | 0.886 | 0.574 | 0.377 | 0.663 |

Native latency measures a warm ONNX graph with one CPU thread. It excludes feature preparation. The [complete benchmark](benchmark.json) includes confusion matrices, runtime version and fold counts. Small denominators and activity distributions affect these rates. A zero in the false-alert column applies only to the evaluated time.

## Four-week replay

All complete windows were scored with the same fitted model. The four-week replay includes its development visits. The forecaster at each instant could use only the current and earlier observations. Untracked seconds and missing check-ins remain missing. The simulated angle uses the ear–shoulder proxy. Direct tragus–C7 measurements require marked images.

| Profile | Week ending | Mean angle (°) | Neutral (%) | Discomfort (0–10) | Drills completed | Paired days | r angle/pain | r neutral/pain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aster | 2026-11-01 | 59.6 | 26.5 | 4.89 | 5 | 6 | -0.00 | 0.25 |
| Aster | 2026-11-08 | 59.3 | 25.9 | 3.76 | 6 | 7 | -0.00 | -0.27 |
| Aster | 2026-11-15 | 60.0 | 28.6 | 3.19 | 5 | 7 | -0.38 | -0.25 |
| Aster | 2026-11-22 | 60.3 | 29.3 | 3.28 | 5 | 6 | 0.73 | -0.38 |
| Birch | 2026-11-01 | 58.4 | 32.5 | 3.83 | 5 | 6 | -0.92 | 0.42 |
| Birch | 2026-11-08 | 58.1 | 32.1 | 2.86 | 4 | 7 | 0.04 | 0.47 |
| Birch | 2026-11-15 | 59.2 | 32.0 | 3.48 | 5 | 7 | -0.42 | -0.62 |
| Birch | 2026-11-22 | 57.9 | 32.8 | 3.39 | 6 | 6 | 0.34 | 0.65 |
| Cedar | 2026-11-01 | 55.5 | 28.3 | 3.71 | 6 | 7 | 0.50 | 0.18 |
| Cedar | 2026-11-08 | 54.3 | 26.5 | 3.06 | 4 | 6 | 0.17 | 0.14 |
| Cedar | 2026-11-15 | 53.6 | 32.2 | 3.14 | 3 | 7 | 0.14 | -0.11 |
| Cedar | 2026-11-22 | 55.6 | 31.0 | 3.56 | 4 | 6 | 0.04 | -0.23 |

### Before and after a recorded change

| Profile | Change | Angle before → after (°) | Neutral before → after (%) | Discomfort before → after | Logged days before / after |
| --- | --- | --- | --- | --- | --- |
| Aster | Raised the monitor | 59.3 → 60.0 | 25.9 → 28.6 | 3.8 → 3.2 | 7 / 7 |
| Birch | Moved the keyboard closer | 58.1 → 59.2 | 32.1 → 32.0 | 2.9 → 3.5 | 7 / 7 |
| Cedar | Added foot support | 54.3 → 53.6 | 26.5 → 32.2 | 3.1 → 3.1 | 6 / 7 |

Both intervals cover seven calendar days. The change date starts follow-up. The generator specifies different symptom responses by profile and includes daily noise. These differences demonstrate the comparison and cannot establish a treatment effect.

### Reminder timing

| Profile | 30-minute timers | During neutral | During slouch | Forecast nudges | Complete 3-minute follow-ups | Followed by sustained slouch | Mean lead (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Aster | 28 | 7 | 11 | 0 | 0 | 0 | — |
| Birch | 28 | 6 | 14 | 1 | 1 | 1 | 17.0 |
| Cedar | 28 | 7 | 13 | 2 | 1 | 1 | 1.0 |

The timer comparison uses one blind prompt at minute 30. The personalized forecaster uses prior completed sessions, current classified observations and the app’s reminder cooldown. For scoring, a later event needs 15 consecutive seconds labeled slouch with at least 7° of angle loss. Lead is measured to the first second of that run. A complete follow-up requires three observed minutes. The simulated participant responds to the scheduled exercise and dismisses other alerts to preserve the trajectory. Real-world alert burden, generalization and symptom effects require observations from people.

### Controlled forecast checks

Two additional 45-minute scenarios start from the same four-week history for each profile. One holds a steady position. The other gradually increases forward displacement from minute 10 through minute 25, then sustains it for 20 minutes. The exported model classifies every window. These scenarios are engineering checks and are excluded from the four-week results.

| Profile | Steady-session forecast nudges | Progressive-session forecast nudges | First 7° loss (min) | Advance notice within 3 min (s) |
| --- | --- | --- | --- | --- |
| Aster | 0 | 1 | 21.4 | 85 |
| Birch | 0 | 0 | 20.9 | — |
| Cedar | 0 | 1 | 20.5 | 61 |

## Measured Windows desktop performance

The installed-format Deskframe 1.1.0 executable ran its actual pose sensor and bundled classifier on an in-memory replay of a generated side-view image. The test host used a 12th Gen Intel(R) Core(TM) i9-12900KF with 24 logical processors and Windows 10.0.26100. Each policy had eight process samples over 24 seconds after warm-up.

| Sampling | Mean CPU (%) | Mean working set (MiB) | Sampled ONNX windows | Mean sampled window (ms) |
| --- | --- | --- | --- | --- |
| adaptive | 0.27 | 664.6 | 3 | 0.167 |
| fixed | 2.41 | 664.4 | 3 | 0.200 |

Across 100 additional warm windows the bundled classifier had a desktop p95 of approximately 0.10 ms, including feature preparation. The renderer clock resolves about 0.1 ms. Its labels matched the Python CPU graph on all 15 cross-runtime cases. The CPU and memory figures sum the Electron processes. A single stable reference on this desktop does not establish laptop battery life or clinical performance. [Sampling results](edge-side-replay.json), [ONNX timings](onnx-replay.json)

Reproduce the study or collect new data using the [research instructions](../README.md). Explore the records under **Trends → Data source** in the desktop app.
