"""Read numeric desktop exports and construct session-bounded evaluation windows."""
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

LABELS = ["neutral", "slouch", "writing", "reading", "reaching"]
CHANNELS = ["cva_drop_deg", "head_forward_delta", "pitch_delta_deg", "shoulder_forward_delta",
            "nose_x", "nose_y", "ear_x", "ear_y", "shoulder_x", "shoulder_y"]
WINDOW = 20


@dataclass
class Windows:
    x: np.ndarray
    y: np.ndarray
    user: np.ndarray
    session: np.ndarray
    second: np.ndarray
    trainable: np.ndarray


def load(paths):
    rows = []
    for path in paths:
        with Path(path).open(encoding="utf-8-sig") as stream:
            for line in stream:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def windows(rows):
    grouped = defaultdict(dict)
    owners = {}
    for r in rows:
        user, session, sec = r["participant"], r["session"], r["second"]
        if (r.get("version") != 1 or r["label"] not in LABELS or not isinstance(user, str)
                or not isinstance(session, str) or type(sec) is not int or sec < 0):
            raise ValueError("Invalid study record or incompatible export version.")
        if owners.setdefault(session, user) != user:
            raise ValueError("A session appears under two participants.")
        v = np.asarray(r["vector"], dtype=np.float32)
        if v.shape != (len(CHANNELS),) or not np.isfinite(v).all():
            raise ValueError("Expected ten finite calibrated channels.")
        value = (r["label"], r["segment"], v.tolist())
        if sec in grouped[session] and grouped[session][sec] != value:
            raise ValueError("Conflicting samples in overlapping exports.")
        grouped[session][sec] = value
    x, y, users, sessions, secs, training = [], [], [], [], [], []
    for session, data in sorted(grouped.items()):
        block = []
        previous = None
        for sec, sample in sorted(data.items()):
            if previous is None or sec != previous + 1:
                block = []
            previous = sec
            block.append(sample)
            block = block[-WINDOW:]
            if len(block) < WINDOW:
                continue
            x.append([v[2] for v in block])
            y.append(LABELS.index(sample[0]))
            users.append(owners[session])
            sessions.append(session)
            secs.append(sec)
            # Training uses an uninterrupted single annotation at a five-second stride.
            training.append(sec % 5 == 0 and all(v[:2] == sample[:2] for v in block))
    if not x:
        raise ValueError("No complete 20-second labeled windows. Record longer continuous blocks.")
    return Windows(np.asarray(x, np.float32), np.asarray(y), np.asarray(users), np.asarray(sessions),
                   np.asarray(secs), np.asarray(training))


def rolling(x):
    a = x.astype(np.float64)
    time = np.arange(WINDOW) - (WINDOW-1)/2
    drift = (a[:, :, 0] >= 7) | (a[:, :, 1] >= np.float32(.10))
    dwell = np.cumprod(drift[:, ::-1], axis=1).sum(axis=1)
    return np.column_stack([a.mean(axis=1), a.std(axis=1),
                            (a * time[None, :, None]).sum(axis=1) / np.dot(time, time),
                            a[:, -1, :], drift.mean(axis=1), dwell]).astype(np.float32)


def fixture():
    """Artificial trajectories exercise graph and split mechanics only."""
    rng = np.random.default_rng(21)
    rows = []
    for user in range(3):
        for visit in range(2):
            sec = 0
            for label_index in rng.permutation(len(LABELS)):
                label = LABELS[label_index]
                for t in range(49):
                    v = rng.normal(0, .03, 10)
                    v[0] += [0, 11, 3, 5, 2][label_index]
                    v[1] += [0, .15, .04, .07, .01][label_index]
                    v[2] += [0, 2, -18, -12, 3][label_index]
                    v[4:] += (label_index * .12 + np.sin(t * (.1 + label_index*.3))*.07)
                    rows.append(dict(version=1, participant=f"fixture-person-{user}", session=f"fixture-{user}-{visit}",
                                     second=sec, label=label, segment=int(label_index), vector=v.tolist()))
                    sec += 1
    return rows
