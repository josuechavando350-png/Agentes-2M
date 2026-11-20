"""Create disjoint chronological contact files from the CC BY 4.0 UCI Bank Marketing archive."""
import csv
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

SOURCE = "e0bf5f5de5b846e2f18e9d90606637267d46dfa260e0f17bb12e605db5efbeb4"
SCHEMA = [["exito-previo", [1]], ["fallo-previo", [1]], ["contactos-previos", [1,2,3,5]],
          ["dias-conocidos", [1]], ["dias-desde-contacto", [1,3,7,14,30]], ["canal-celular", [1]],
          ["intentos-previos-actuales", [1,2,3,5,8]], ["dia-laboral", [1,2,3,4]]]


def main(source, folder):
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE:
        raise ValueError("El archivo difiere de la fuente fijada")
    with zipfile.ZipFile(io.BytesIO(raw)) as outer:
        nested = outer.read("bank-additional.zip")
    with zipfile.ZipFile(io.BytesIO(nested)) as inner:
        text = inner.read("bank-additional/bank-additional-full.csv").decode()
    rows = csv.DictReader(io.StringIO(text), delimiter=";")
    packet = {"source": SOURCE, "schema": SCHEMA, "fit": [], "select": [], "calibrate": [], "holdout": []}
    answers = []
    for i,row in enumerate(rows):
        previous = int(row["pdays"])
        x = [int(row["poutcome"] == "success"), int(row["poutcome"] == "failure"), int(row["previous"]),
             int(previous != 999), previous if previous != 999 else 0, int(row["contact"] == "cellular"),
             int(row["campaign"])-1, ["mon","tue","wed","thu","fri"].index(row["day_of_week"])]
        sample = {"id": "contacto-"+str(i+2), "x": x}
        group = "fit" if i<23000 else "select" if i<28000 else "calibrate" if i<32000 else "holdout"
        label = int(row["y"] == "yes")
        if group == "holdout":
            answers.append({"id": sample["id"], "accepted": label})
        else:
            sample["accepted"] = label
        packet[group].append(sample)
    if len(answers)!=9188:
        raise ValueError("Número de contactos inesperado")
    folder.mkdir(exist_ok=True,parents=True)
    for name,item in [("packet",packet),("answers",answers)]:
        (folder/(name+".json")).write_text(json.dumps(item,separators=(",",":"))+"\n")

if __name__=="__main__":
    main(*map(Path,sys.argv[1:]))
