"""Prepare auditable cancellation groups from Daqing Chen's Online Retail (UCI, CC BY 4.0)."""
import hashlib
import io
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile
from openpyxl import load_workbook

SOURCE = "f5385cbb54bbebf7196389109c6b0621faab0c304e3702548165e71c84aede8b"


def prepare(source, destination):
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE:
        raise ValueError("Fuente distinta de Online Retail")
    with ZipFile(io.BytesIO(data)) as zf:
        wb = load_workbook(io.BytesIO(zf.read("Online Retail.xlsx")),read_only=True,data_only=True)
    rows = wb.active.values
    header = next(rows)
    if list(header)[:8] != ["InvoiceNo","StockCode","Description","Quantity","InvoiceDate","UnitPrice","CustomerID","Country"]:
        raise ValueError("Columnas desconocidas")
    valid, needed, counts = [], set(), Counter()
    for index, (invoice,sku,_,qty,dt,price,buyer,_) in enumerate(rows, 2):
        counts["sourceRows"] += 1
        invoice, sku = str(invoice), str(sku).upper()
        if buyer is None:
            counts["missingCustomer"] += 1
            continue
        if not re.fullmatch(r"[0-9]{5}[A-Z]*",sku):
            counts["excludedNonMerchandiseCode"] += 1
            continue
        p=Decimal(str(price))*100
        if p<=0 or p!=p.to_integral_value() or not isinstance(qty,int) or not qty:
            counts["invalidQuantityOrPrice"] += 1
            continue
        if (qty<0) != invoice.upper().startswith("C"):
            counts["outsideSaleCancellationConvention"] += 1
            continue
        customer = str(int(buyer))
        group = (customer,sku,int(p))
        when = int(dt.replace(tzinfo=timezone.utc).timestamp()*1000)
        valid.append((index,group,qty,when,invoice))
        if qty < 0:
            needed.add(group)
    wb.close()
    lines=[{"id":"r-"+str(index),"row":index,"party":group[0],"sku":group[1],"price":group[2],"qty":qty,"time":when,"invoice":invoice}
           for index,group,qty,when,invoice in valid if group in needed]
    counts["salesOutsideAnyTargetGroup"] = len(valid)-len(lines)
    counts["admittedRows"]=len(lines)
    epoch=lambda y,m,d:int(datetime(y,m,d,tzinfo=timezone.utc).timestamp()*1000)
    packet={"source":SOURCE,"currency":"GBP","from":epoch(2010,12,1),"until":epoch(2011,12,10),"maxAgeDays":90,"lines":lines}
    destination.mkdir(exist_ok=True,parents=True)
    for name,obj in [("packet",packet),("intake",dict(counts))]:
        (destination/(name+".json")).write_text(json.dumps(obj,separators=(",",":"))+"\n")


if __name__=="__main__":
    prepare(*map(Path,sys.argv[1:]))
