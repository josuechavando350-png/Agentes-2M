"""Derive dated account dossiers from D. Chen, Online Retail, UCI (CC BY 4.0)."""
import argparse
import hashlib
import io
import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook

ARCHIVE = "f5385cbb54bbebf7196389109c6b0621faab0c304e3702548165e71c84aede8b"
SPLITS = [
    ("train", date(2011, 4, 1), {0, 1}, 1000),
    ("validation", date(2011, 7, 1), {2}, 400),
    ("test", date(2011, 10, 1), {3}, 240),
]


def fingerprint(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def prepare(archive, destination, reserve=False):
    raw = archive.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ARCHIVE:
        raise ValueError("La huella del archivo de UCI no coincide")
    by_account = defaultdict(dict)
    with ZipFile(io.BytesIO(raw)) as z:
        wb = load_workbook(io.BytesIO(z.read("Online Retail.xlsx")), read_only=True, data_only=True)
        try:
            for row, (inv, sku, _, qty, when, price, buyer, _) in enumerate(
                    wb.active.iter_rows(min_row=2, values_only=True), 2):
                if buyer is None or not qty or price is None or price <= 0:
                    continue
                inv = str(inv)
                key = str(int(buyer))
                amount = int((Decimal(str(price)) * qty * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
                invoice = by_account[key].setdefault(inv, [when.date(), 0, set(), row])
                invoice[1] += amount
                invoice[2].add(str(sku))
        finally:
            wb.close()
    destination.mkdir(parents=True, exist_ok=True)
    used = set()
    splits = SPLITS + ([("reserve", date(2011, 11, 9), {0, 1, 2, 3}, 480)] if reserve else [])
    for split, cutoff, buckets, limit in splits:
        past = []
        outcomes = {}
        for customer, invoices in by_account.items():
            hashed = fingerprint("semar-business-v1/" + customer)
            if int(hashed[:8], 16) % 4 not in buckets:
                continue
            history = [(k, *v) for k, v in invoices.items() if cutoff-timedelta(days=90) <= v[0] < cutoff]
            orders = sorted((r for r in history if not r[0].startswith("C") and r[2] > 0), key=lambda r: (r[1], r[0]))
            if not orders:
                continue
            gross = sum(r[2] for r in orders)
            last = orders[-1]
            days = (last[1] - orders[0][1]).days
            features = {
                "recency": (cutoff-last[1]).days, "orders": len(orders), "gross_pence": gross,
                "returns_permille": round(1000 * sum(-min(0, r[2]) for r in history) / gross),
                "recent_orders": sum(r[1]>=cutoff-timedelta(days=30) for r in orders),
                "active_weeks": len({r[1].isocalendar()[:2] for r in orders}),
                "sku_count": len(set().union(*(r[3] for r in orders))),
                "largest_share": round(1000*max(r[2] for r in orders)/gross),
                "gap_days": round(days/(len(orders)-1)) if len(orders)>1 else 90,
                "last_pence": last[2],
            }
            cid = "u-" + hashed[:18]
            if split == "reserve" and cid in used:
                continue
            refs = [{"invoice":r[0],"firstRow":r[4],"day":r[1].isoformat()} for r in sorted(history)]
            past.append({"id":cid,"cutoff":cutoff.isoformat(),"features":features,"references":refs})
            future = [(k,v) for k,v in invoices.items() if cutoff<=v[0]<cutoff+timedelta(days=30)]
            net = sum(v[1] for _,v in future)
            outcomes[cid]=int(net>0 and any(not k.startswith("C") and v[1]>0 for k,v in future))
        # Selection uses only historical eligibility and a hash of the account ID.
        cases = sorted(past,key=lambda r:r["id"])[:limit]
        used.update(r["id"] for r in cases)
        for suffix, data in [("cases",cases),("outcomes",{r["id"]:outcomes[r["id"]] for r in cases})]:
            (destination/f"{split}-{suffix}.json").write_text(json.dumps(data,separators=(",",":"))+"\n")
        print(split,len(cases))


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("archive",type=Path)
    parser.add_argument("destination",type=Path)
    parser.add_argument("--reserve", action="store_true")
    args=parser.parse_args()
    prepare(args.archive,args.destination,args.reserve)
