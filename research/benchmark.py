"""Benchmark activity models on held-out sessions and participants."""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from dataset import CHANNELS, LABELS, WINDOW, fixture, load, rolling, windows










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
