"""Prepare a public historical randomized trial. Holdout outcomes go to a separate file."""
import csv
import hashlib
import io
import json
import sys
from decimal import Decimal
from pathlib import Path

SOURCE_SHA256 = "00a6a868e05a9ffe7382da51629f6d6dce88c5acfc945e79d314ebc78fd3a2c0"
SEED = "semar-hillstrom-01-fixed-before-grading"
ACTIONS = ["No E-Mail", "Mens E-Mail", "Womens E-Mail"]
FIELDS = [
    ("recency", [1, 2, 3, 4, 6, 8, 10, 12]),
    ("history-cents", [5000, 10000, 15000, 20000, 35000, 50000, 75000, 100000]),
    ("mens", [1]), ("womens", [1]), ("newbie", [1]),
    ("urban", [1]), ("rural", [1]), ("web", [1]), ("phone", [1]),
]


def prepare(source, destination):
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("CSV distinto de la fuente fijada")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf8"))))
    assert len(rows) == 64000
    order = sorted(range(len(rows)), key=lambda n: hashlib.sha256(f"{SEED}/{n}".encode()).digest())
    groups = {"fit": [], "search": [], "validation": [], "holdout": []}
    labels = []
    for i, n in enumerate(order):
        row = rows[n]
        values = [int(row["recency"]), int(Decimal(row["history"]) * 100),
                  int(row["mens"]), int(row["womens"]), int(row["newbie"]),
                  int(row["zip_code"] == "Urban"), int(row["zip_code"] == "Rural"),
                  int(row["channel"] == "Web"), int(row["channel"] == "Phone")]
        identity = "h-" + str(n + 2)
        sample = {"id": identity, "x": values}
        observed = {"arm": ACTIONS.index(row["segment"]), "y": int(Decimal(row["spend"]) * 100)}
        group = "fit" if i < 16000 else "search" if i < 26000 else "validation" if i < 40000 else "holdout"
        if group == "holdout":
            labels.append({"id": identity, **observed})
        else:
            sample.update(observed)
        groups[group].append(sample)
    design = {"actions": ["control", "oferta-a", "oferta-b"],
              "fields": [{"id": name, "cuts": cuts} for name, cuts in FIELDS],
              "costs": [0, 0, 0], "currency": "USD", "response": "ventas-centavos",
              "randomization": "equal-thirds"}
    destination.mkdir(parents=True, exist_ok=True)
    for name, obj in [("packet", {"design": design, **groups, "limits": [1, 100, 1000, 10000]}),
                      ("outcomes", labels)]:
        (destination / (name+".json")).write_text(json.dumps(obj,separators=(",", ":"))+"\n")


if __name__ == "__main__":
    prepare(*map(Path, sys.argv[1:]))
