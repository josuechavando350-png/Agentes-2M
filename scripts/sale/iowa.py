"""Derive strictly earlier SKU price observations and chronological blind samples from the pinned Iowa mirror."""
import calendar
import hashlib
import json
import sys
from datetime import date, timedelta
from pathlib import Path
import duckdb

SOURCE = "5c73d802109e24c5160d3920c8821e37d3b60132bfc287ae1b66bae95bb077aa"
COLUMNS = "Invoice, cast(Date as date) as day, Store_num, Item_num, Bottle_retail, Bottle_count, Cents, file_row_number as pos"
VALID = "Invoice is not null and Store_num is not null and Item_num is not null and Bottle_count between 1 and 10000 and Bottle_retail between 1 and 100000 and Cents is not null"


def sample(db, path, year, month, count):
    start = date(year, month, 1)
    end = start + timedelta(days=calendar.monthrange(year, month)[1])
    return db.execute(f"""select {COLUMNS} from read_parquet(?,file_row_number=true)
        where {VALID} and Date>=? and Date<? qualify row_number() over(partition by Invoice order by file_row_number)=1
        order by sha256(concat('semar-diagnostico-v1/',Invoice)),file_row_number limit ?""",
        [path, start, end, count]).fetchall()


def build(db, path, targets):
    db.execute("create or replace temp table selected (id varchar, day date, sku varchar)")
    db.executemany("insert into selected values (?,?,?)", [(r[0],r[1],r[3]) for r in targets])
    # Collapse repeats from a shop on the same day. A signed price list would be a separate stronger source.
    quotes = db.execute(f"""with recent as (select {COLUMNS} from read_parquet(?,file_row_number=true)
      where {VALID} and Date>=? and Date<? and Cents>0 and Cents%Bottle_count=0
      and Item_num in (select sku from selected)),
    daily as (select * from recent qualify row_number() over(partition by Item_num,day,Store_num order by Invoice,pos)=1),
    prior as (select t.id,r.day,r.Store_num,r.Invoice,r.pos,r.Cents//r.Bottle_count unit_cents
      from selected t join daily r on r.Item_num=t.sku and r.day<t.day and r.day>=t.day-interval 21 day
      qualify row_number() over(partition by t.id order by r.day desc,sha256(r.Store_num),r.Invoice,r.pos)<=12)
    select * from prior order by id,day desc,Store_num,Invoice,pos""",
        [path,min(r[1] for r in targets)-timedelta(days=21),max(r[1] for r in targets)]).fetchall()
    by_id = {}
    item = {r[0]: r[3] for r in targets}
    for inv, when, store, ref, pos, cents in quotes:
        by_id.setdefault(inv,[]).append({"day":when.isoformat(),"sku":item[inv],"store":store,"invoice":ref,"row":pos,"unit":cents})
    features, labels = [], []
    for inv, when, store, sku, retail, units, amount, pos in targets:
        features.append({"id":"ia-"+inv,"invoice":inv,"row":pos,"day":when.isoformat(),"sku":sku,"store":store,
                         "listed":retail,"units":units,"prior":by_id.get(inv,[])})
        labels.append({"id":"ia-"+inv,"cents":amount})
    return features, labels


def run(source, folder, earlier):
    with source.open("rb") as f:
        if hashlib.file_digest(f,"sha256").hexdigest()!=SOURCE:
            raise ValueError("Parquet distinto de la revisión")
    folder.mkdir(parents=True,exist_ok=True)
    failed=[e["invoice"] for g in json.loads(earlier.read_text())["periods"] for e in g["errors"]]
    with duckdb.connect() as db:
        db.execute("set threads=4")
        splits={}
        for year,month,n,group in [(2018,8,150,"dev-a"),(2019,8,150,"dev-b"),(2020,8,200,"future-a"),(2020,10,200,"future-b")]:
            splits[group]=build(db,str(source),sample(db,str(source),year,month,n))
        targets=db.execute(f"select {COLUMNS} from read_parquet(?,file_row_number=true) where Invoice in (select unnest(?)) order by Invoice,pos",[str(source),failed]).fetchall()
        splits["old-errors"]=build(db,str(source),targets)
    for group,(features,labels) in splits.items():
        for name, obj in [("cases",features),("answers",labels)]:
            (folder/f"{group}-{name}.json").write_text(json.dumps(obj,separators=(",",":"))+"\n")


if __name__ == "__main__":
    run(*map(Path,sys.argv[1:]))
