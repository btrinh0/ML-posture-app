import json
import gzip
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

LABELS = ["neutral", "slouch", "writing", "reading", "reaching"]
CHANNELS = ["cva_drop_deg", "head_forward_delta", "pitch_delta_deg", "shoulder_forward_delta",
            "nose_x", "nose_y", "ear_x", "ear_y", "shoulder_x", "shoulder_y"]
WINDOW = 20



def load(paths):
    rows = []
    for path in paths:
        path = Path(path)
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, mode="rt", encoding="utf-8-sig") as stream:
            for line in stream:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def validated_sessions(rows):
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
    return grouped




def fixture():
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
