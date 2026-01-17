"""Benchmark activity models on held-out sessions and participants."""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.metrics import confusion_matrix, f1_score

from dataset import CHANNELS, LABELS, WINDOW, fixture, load, rolling, windows




def metrics(records):
    truth = [r[2] for r in records]
    pred = [r[3] for r in records]
    classes = list(range(len(LABELS)))
    false_alerts = alerts = 0
    last_session, last_sec, since, last_alert, armed = None, None, None, -1000, True
    for session, sec, label, guess in sorted(records):
        if session != last_session:
            last_alert = -1000
        if session != last_session or sec != last_sec+1:
            since, armed = None, True
        if guess == 1:
            since = sec if since is None else since
            if armed and sec-since >= 15:
                armed = False
                if sec-last_alert >= 120:
                    alerts += 1
                    false_alerts += label != 1
                    last_alert = sec
        else:
            since, armed = None, True
        last_session, last_sec = session, sec
    return dict(macro_f1=float(f1_score(truth,pred,labels=classes,average="macro",zero_division=0)),
                class_f1=dict(zip(LABELS,f1_score(truth,pred,labels=classes,average=None,zero_division=0).tolist())),
                confusion=confusion_matrix(truth,pred,labels=classes).tolist(), evaluated_seconds=len(records),
                alerts=alerts, false_alerts=int(false_alerts), false_alerts_per_hour=float(false_alerts*3600/len(records)))






def partition(rows):
    sources = {r.get("provenance","user_sessions") for r in rows}
    if len(sources) != 1 or not sources <= {"user_sessions","simulated_study"}:
        raise ValueError("Use a single known provenance per benchmark. Keep generated and personal exports separate.")
    development, followup = [], []
    for row in rows:
        part=row.get("partition","development")
        if part not in ("development","follow_up"):
            raise ValueError("Unknown study partition.")
        (development if part=="development" else followup).append(row)
    if {r["session"] for r in development} & {r["session"] for r in followup}:
        raise ValueError("A session crosses the development and follow-up boundary.")
    return sources.pop(), windows(development), windows(followup) if followup else None
