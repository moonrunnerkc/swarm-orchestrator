"""Writes a study configuration for launches that start from retained candidates.

    python3 make-config.py --kind development|matched --revision <rev> --protocol <file> --out <file>

The pins, budgets and isolation are the October 24 studies', with this stage's input root and
directory added to what every launch is denied.
"""
import argparse, hashlib, json, os

home = os.path.expanduser("~")
stage = f"{home}/.cache/swarm-study-2026-10-24b"
candidates = f"{stage}/inputs"
parser = argparse.ArgumentParser()
parser.add_argument("--kind", required=True)
parser.add_argument("--revision", required=True)
parser.add_argument("--protocol", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()

base = json.load(open(f"{home}/.cache/swarm-study-2026-10-24/confirm-config.json"))
dev = json.load(open(os.path.join(os.path.dirname(__file__), "../development/development-set.json")))
by_id = {one["id"]: one for one in dev["cases"]}

def frozen(case_id):
    one = by_id[case_id]
    name = f"candidates/{one['patch']}"
    data = open(os.path.join(candidates, name), "rb").read()
    digest = "sha256:" + hashlib.sha256(data).hexdigest()
    assert digest == one["digest"], case_id
    return {"name": name, "digest": digest}

if args.kind == "development":
    cells = [("D1", 1), ("D2", 2), ("D3", 3), ("D4", 1), ("D5", 1), ("D6", 1), ("C1", 4), ("C2", 2), ("C3", 2)]
    arms = ["swarm"]
    launches = [
        {"task": by_id[c]["task"], "arm": "swarm", "order": i, "sample": s, "candidate": c}
        for i, (c, s) in enumerate(cells)
    ]
else:
    # Two task types, a defective and a correct candidate of each, two samples per arm, the arm
    # that goes first alternating cell by cell and sample by sample.
    cells = [("D1", 1), ("C1", 3), ("D4", 1), ("C2", 3)]
    arms = ["swarm", "swarm-control"]
    launches, order = [], 0
    for index, (c, s) in enumerate(cells):
        for repeat in range(2):
            first = arms if (index + repeat) % 2 == 0 else list(reversed(arms))
            for arm in first:
                launches.append({"task": by_id[c]["task"], "arm": arm, "order": order, "sample": s + repeat, "candidate": c})
                order += 1

cli = f"{home}/.cache/swarm-comparison/tools/swarm-study-{args.revision}/dist/cli.js"
config = {
    **{k: v for k, v in base.items() if k not in ("launches", "taskIds", "protocol", "arms", "armSettings", "pins", "samples")},
    "tasksModule": f"{stage}/tasks.mjs",
    "taskIds": sorted({one["task"] for one in launches}),
    "protocol": args.protocol,
    "arms": arms,
    "samples": 2 if args.kind == "matched" else 1,
    "armSettings": {"swarm": {"flags": ["--adaptive", "--review", "executable"]}, "swarm-control": {"flags": ["--adaptive"]}},
    "order": "listed",
    "launches": launches,
    "pins": {**base["pins"], "swarmCli": cli, "swarmRevision": args.revision},
    "inputRoots": base["inputRoots"] + [candidates],
    "startingCandidates": {c: frozen(c) for c in sorted({one["candidate"] for one in launches})},
}
iso = config["isolation"]
iso["protectedRoots"] = sorted(set(iso["protectedRoots"] + [stage]))
iso["readableRoots"] = [r.replace("swarm-study-d5a666588", f"swarm-study-{args.revision}") for r in iso["readableRoots"]]
iso["reprotectedRoots"] = [r.replace("swarm-study-d5a666588", f"swarm-study-{args.revision}") for r in iso["reprotectedRoots"]]
config["exposureMarkers"] = sorted(set(base["exposureMarkers"] + ["swarm-study-2026-10-24b"]))
json.dump(config, open(args.out, "w"), indent=2)
print(f"{len(launches)} launches -> {args.out}")
