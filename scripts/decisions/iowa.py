"""Derive disjoint merchant/period cohorts from Iowa's public wholesale ledger."""
import hashlib
import json
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
import duckdb

SOURCE = "5c73d802109e24c5160d3920c8821e37d3b60132bfc287ae1b66bae95bb077aa"

def account(store):
    return "ia-" + hashlib.sha256(("iowa-store/" + store).encode()).hexdigest()[:20]

def dossier(store, cutoff, items):
    days = defaultdict(list)
    for when, invoice, sku, cents, row in items:
        days[when].append((invoice, sku, cents, row))
    orders, refs, skus, refunds = [], [], set(), 0
    for when, lines in sorted(days.items()):
        net = sum(line[2] for line in lines)
        refunds += sum(-min(0, line[2]) for line in lines)
        for inv, sku, cents, row in sorted(lines):
            refs.append({"invoice": ("C" if cents < 0 else "") + inv, "day": when.isoformat(), "firstRow": row + 2})
            if cents > 0:
                skus.add(sku)
        if net > 0:
            orders.append((when, net))
    if not orders or len(refs) > 8192:
        return None
    gross = sum(v for _, v in orders)
    last = orders[-1]
    fields = {
        "recency": (cutoff-last[0]).days, "orders": len(orders), "gross_pence": gross,
        "returns_permille": round(1000*refunds/gross), "recent_orders": sum(d >= cutoff-timedelta(days=30) for d,_ in orders),
        "active_weeks": len({d.isocalendar()[:2] for d,_ in orders}), "sku_count": len(skus),
        "largest_share": round(1000*max(v for _,v in orders)/gross),
        "gap_days": round((last[0]-orders[0][0]).days/(len(orders)-1)) if len(orders)>1 else 90,
        "last_pence": last[1],
    }
    return {"id": account(store),"cutoff": cutoff.isoformat(),"features": fields,"references": refs}

def prepare(source, dest):
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != SOURCE:
            raise ValueError("La huella del archivo de Iowa no coincide")
    dest.mkdir(parents=True, exist_ok=True)
    used = set()
    with duckdb.connect() as db:
        for cutoff in (date(2018,4,1), date(2019,4,1)):
            for vendor in ("260", "421"):
                key = f"ia-{vendor}-{cutoff.year}"
                rows = db.execute("""select Store_num,cast(Date as date),Invoice,Item_num,Cents,file_row_number
                    from read_parquet(?,file_row_number=true) where Vendor_num=? and Date>=? and Date<?
                    and Store_num is not null and Cents is not null and Cents<>0""",
                    [str(source),vendor,cutoff-timedelta(days=90),cutoff]).fetchall()
                groups = defaultdict(list)
                for store, *item in rows:
                    groups[store].append(item)
                selected = {}
                for store in sorted(groups, key=account):
                    if store not in used:
                        row = dossier(store,cutoff,groups[store])
                        if row:
                            selected[store] = row
                    if len(selected) == 200:
                        break
                if len(selected) != 200:
                    raise ValueError("Faltan tiendas elegibles")
                used.update(selected)
                (dest/(key+"-cases.json")).write_text(json.dumps(list(selected.values()),separators=(",",":")))
                net = dict(db.execute("""select Store_num,sum(Cents) from read_parquet(?) where Vendor_num=?
                    and Date>=? and Date<? group by Store_num""", [str(source),vendor,cutoff,cutoff+timedelta(days=30)]).fetchall())
                labels = {r["id"]: int(net.get(s,0)>0) for s,r in selected.items()}
                (dest/(key+"-outcomes.json")).write_text(json.dumps(labels,separators=(",",":")))

if __name__ == "__main__":
    prepare(Path(sys.argv[1]), Path(sys.argv[2]))
