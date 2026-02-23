"""Benchmark activity models on held-out sessions and participants."""
import argparse
import base64
import json
import platform
from collections import defaultdict
from pathlib import Path
from time import perf_counter_ns

import numpy as np
import onnxruntime as ort
from sklearn.metrics import confusion_matrix, f1_score

from dataset import CHANNELS, LABELS, WINDOW, fixture, load, rolling, windows
from models import fit

KINDS = ("rules", "tree", "cnn", "tree_levels_only")


def inference(graph, kind, x):
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    session = ort.InferenceSession(graph, options, providers=["CPUExecutionProvider"])
    inputs = rolling(x) if kind.startswith("tree") else x
    session.run(None, {"input": inputs[:1]})
    pred, latency = [], []
    for row in inputs:
        start = perf_counter_ns()
        scores, = session.run(None, {"input": np.ascontiguousarray(row[None])})
        latency.append((perf_counter_ns()-start)/1e6)
        pred.append(int(scores.argmax()))
    return np.asarray(pred), latency


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


def splits(data, epochs):
    report = {}
    for scheme, groups in [("leave_one_session_out",data.session),("leave_one_participant_out",data.user)]:
        folds, aggregate, times = defaultdict(dict), defaultdict(list), defaultdict(list)
        if len(set(groups)) < 2:
            raise ValueError(f"{scheme} needs at least two independent groups.")
        for group in sorted(set(groups)):
            test = groups == group
            train = ~test & data.trainable
            if set(data.y[train]) != set(range(len(LABELS))):
                raise ValueError(f"Training fold excluding {group} needs stable examples of all five activities.")
            for kind in KINDS:
                graph = fit(kind, data.x[train], data.y[train], epochs)
                guesses, latency = inference(graph,kind,data.x[test])
                records = list(zip(data.session[test],data.second[test],data.y[test],guesses))
                aggregate[kind].extend(records)
                times[kind].extend(latency)
                folds[kind][group] = metrics(records)
        report[scheme] = {kind:{**metrics(aggregate[kind]),"p50_ms":float(np.median(times[kind])),
                                "p95_ms":float(np.percentile(times[kind],95)),"folds":folds[kind]} for kind in KINDS}
    return report


def transfer(data, epochs):
    results = {}
    for user in sorted(set(data.user)):
        train = data.trainable & (data.user == user)
        if len(set(data.y[train])) != len(LABELS):
            results[user] = {"eligible": False, "reason": "Missing training activities"}
            continue
        results[user] = {}
        for kind in KINDS:
            graph = fit(kind,data.x[train],data.y[train],epochs)
            for other in sorted(set(data.user)-{user}):
                test = data.user == other
                pred,_ = inference(graph,kind,data.x[test])
                results[user].setdefault(other,{})[kind] = metrics(list(zip(
                    data.session[test],data.second[test],data.y[test],pred)))
    return results


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


def bundle(kind, graph, source):
    result = dict(format="deskframe.model.v1", kind="tree" if kind.startswith("tree") else kind,
                  labels=LABELS, channels=CHANNELS, seconds=WINDOW, provenance=source,
                  model=base64.b64encode(graph).decode("ascii"))
    if kind == "tree_levels_only":
        result["variant"] = "mean_and_latest"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exports",nargs="*",type=Path)
    parser.add_argument("--out",required=True,type=Path)
    parser.add_argument("--epochs",type=int,default=18)
    parser.add_argument("--smoke",action="store_true",help="Use synthetic fixtures.")
    args = parser.parse_args()
    if args.smoke == bool(args.exports) or args.epochs < 1:
        parser.error("Supply either real profile exports or --smoke, and a positive epoch count.")
    if args.smoke:
        source,data,followup = "synthetic_smoke",windows(fixture()),None
    else:
        source,data,followup = partition(load(args.exports))
    results = splits(data,args.epochs)
    scores = results["leave_one_session_out"]
    candidates = [k for k in KINDS if scores[k]["p95_ms"] < 15]
    if candidates:
        chosen = max(candidates,key=lambda k:(scores[k]["macro_f1"],-scores[k]["false_alerts_per_hour"],-scores[k]["p95_ms"]))
    else:
        chosen = min(KINDS,key=lambda k:scores[k]["p95_ms"])
    report = dict(provenance=source, participants=len(set(data.user)), sessions=len(set(data.session)),
                  window_seconds=WINDOW, labels=LABELS, selected=chosen, met_latency_target=bool(candidates),
                  environment={"os":platform.platform(),"onnxruntime":ort.__version__}, results=results)
    args.out.mkdir(parents=True,exist_ok=True)
    report["single_participant_transfer"]=transfer(data,args.epochs)
    if followup is not None:
        report["follow_up"]={"sessions":len(set(followup.session)),"participants":len(set(followup.user)),"models":{}}
    for kind in (KINDS if followup is not None else ("rules","tree","cnn") if args.smoke else (chosen,)):
        graph = fit(kind,data.x[data.trainable],data.y[data.trainable],args.epochs)
        if followup is not None:
            pred,timing=inference(graph,kind,followup.x)
            report["follow_up"]["models"][kind]={**metrics(list(zip(followup.session,followup.second,followup.y,pred))),
                                                 "p95_ms":float(np.percentile(timing,95))}
        if not args.smoke and kind != chosen:
            continue
        name = f"fixture-{kind}.deskmodel" if args.smoke else "activity.deskmodel"
        (args.out/name).write_text(json.dumps(bundle(kind,graph,source)),encoding="utf-8")
        if args.smoke:
            indices = np.linspace(0,len(data.x)-1,10,dtype=int)
            tests = data.x[indices]
            pred,_ = inference(graph,kind,tests)
            (args.out/f"parity-{kind}.json").write_text(json.dumps(dict(x=tests.tolist(),y=pred.tolist())),encoding="utf-8")
    (args.out/"benchmark.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(f"{source}: {report['sessions']} sessions, {report['participants']} participants; selected {chosen}.")
    print(f"Report and model saved to {args.out}.")


if __name__ == "__main__":
    main()
