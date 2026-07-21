"""Generate four weeks of simulated desk sessions."""
import argparse
import base64
import gzip
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from dataset import LABELS, WINDOW, rolling

SEED = 41723
START = date(2026, 6, 15)
PEOPLE = ("Aster", "Birch", "Cedar")
VISITS = {2: "development", 8: "development", 15: "development", 24: "follow_up"}
SECONDS = 45 * 60
CAPTURE = 600
CHANGES = (("Raised the monitor", "screen"), ("Moved the keyboard closer", "reach"),
           ("Added foot support", "seat"))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def write_gzip(path, lines):
    with path.open("wb") as dest, gzip.GzipFile(filename="", fileobj=dest, mode="wb", mtime=0) as stream:
        for line in lines:
            stream.write((json.dumps(line, separators=(",", ":"), allow_nan=False) + "\n").encode())


def activity_plan(rng):
    labels, blocks = [], []
    while len(labels) < SECONDS:
        for state in rng.permutation(5):
            duration = int(rng.integers(*[(29, 70), (32, 73), (30, 67), (5, 18), (3, 13)][state]))
            labels.extend([int(state)] * duration)
            blocks.extend([len(blocks)] * duration)
    return np.array(labels[:SECONDS]), np.array(blocks[:SECONDS])


def pose_channels(forward, up, torso, pitch, face):
    vx, vy = np.sin(torso), np.cos(torso)
    ex = vx + forward*vy + up*vx
    ey = vy - forward*vx + up*vy
    nx, ny = ex+face*np.cos(pitch), ey+face*np.sin(pitch)
    return np.column_stack(np.broadcast_arrays(np.degrees(np.arctan2(up,forward)),forward,
        np.degrees(pitch),vx,nx,ny,ex,ey,vx,vy))


def simulate(person, day):
    rng = np.random.default_rng([SEED, person, day])
    state, segment = activity_plan(rng)
    t = np.arange(SECONDS)
    after = day >= 14
    scale = (0.89, 1.10, 1.00)[person] * rng.uniform(.90, 1.12)
    roll = rng.uniform(-.075, .075)
    baseline_forward = (.13, .18, .16)[person] + rng.normal(0, .018)
    baseline_up = (.39, .44, .36)[person] * rng.uniform(.95, 1.05)
    face = (.154, .178, .165)[person]
    phase = rng.uniform(-np.pi, np.pi)
    fatigue = np.maximum(t/60 - (11 + 3*person + rng.uniform(-3, 3)), 0) / 29
    fatigue = np.clip(fatigue, 0, 1.3)**1.7 * (.075, .048, .086)[person] * (0.72 if after else 1)
    # Writing and reading overlap slouch angles by design.
    f = np.zeros(SECONDS); p = f.copy(); s = f.copy(); u = f.copy()
    for start in np.flatnonzero(np.r_[True, np.diff(segment) != 0]):
        label = state[start]
        end = int(np.searchsorted(segment, start, side="right"))
        z = np.arange(end-start)
        def wave(freq):
            return np.sin(z*freq + rng.uniform(-np.pi, np.pi))
        forward = rng.normal([0,.115,.10,.085,.065][label],[.014,.029,.028,.028,.039][label])
        pitch = rng.normal([0,-5,-20,-22,-4][label],[2,4,5,5,6][label])
        shoulder = rng.normal([0,.048,.031,.012,.115][label],[.009,.018,.014,.015,.04][label])
        motion = [0.005,.004,.022,.007,.040][label]
        f[start:end] = forward + wave(rng.uniform(.25,1.55))*motion
        p[start:end] = pitch + wave(rng.uniform(.3,1.6))*[1.5,1.1,5.,1.8,5.5][label]
        s[start:end] = shoulder + wave(.8)*motion*.72
        u[start:end] = -forward*.15 + wave(1.3)*motion*.35
    def smooth(signal, noise):
        signal = signal + rng.normal(0,noise,len(signal))
        return np.convolve(np.pad(signal, (3,0),mode="edge"), [.48,.29,.15,.08], mode="valid")
    forward = baseline_forward + smooth(f*scale + fatigue + .005*np.sin(t/29+phase),.004)
    up = baseline_up + smooth(u,.005)
    torso = roll + smooth(s*(1 if person != 1 else 1.15),.006)
    pitch = np.deg2rad(smooth(p+np.sin(t/43)*1.1,.8))
    baseline = pose_channels(baseline_forward,baseline_up,roll,0,face)[0]
    raw = pose_channels(forward,up,torso,pitch,face)
    vector = raw-baseline
    vector[:,0] *= -1
    valid = np.ones(SECONDS, dtype=bool)
    for start in rng.integers(35,SECONDS-12,size=2):
        valid[start:start+int(rng.integers(2,7))] = False
    return state,segment,vector.astype(np.float32),baseline[0],valid




def generate(out, model=None):
    out.mkdir(parents=True,exist_ok=True)
    session = kind = None
    diary, replay, cases, parity = [], [], [], []
    for person,name in enumerate(PEOPLE):
        exported=[]
        for day in range(28):
            day_text = (START+timedelta(days=day)).isoformat()
            key = f"sim-{name.lower()}-{day_text}"
            state,segment,x,baseline,valid = simulate(person,day)
            if day in VISITS and not model:
                for sec in np.flatnonzero(valid[:CAPTURE]):
                    exported.append(dict(version=1, provenance="simulated_study", partition=VISITS[day],
                        participant="sim-"+name.lower(),session=key,day=day_text,second=int(sec),
                        segment=int(segment[sec]),label=LABELS[state[sec]],overridden=0,
                        vector=np.round(x[sec].astype(float),5).tolist()))
        if not model:
            write_gzip(out/f"{name.lower()}-labels.jsonl.gz",exported)


if __name__ == "__main__":
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument("--out",type=Path,required=True)
    options=args.parse_args()
    generate(options.out)
