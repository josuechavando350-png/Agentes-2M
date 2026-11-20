"""Extract the fixed offline exam from the same attributed Iowa mirror as the commercial census."""
import hashlib
import json
import sys
from pathlib import Path
import duckdb

source, output = map(Path, sys.argv[1:])
expected = "5c73d802109e24c5160d3920c8821e37d3b60132bfc287ae1b66bae95bb077aa"
with source.open("rb") as stream:
    assert hashlib.file_digest(stream, "sha256").hexdigest() == expected
seen = set()
groups = []
with duckdb.connect() as db:
    for year, count in [(2018, 20), (2019, 120), (2020, 120)]:
        rows = db.execute("""
            select Invoice, file_row_number, Bottle_retail, Bottle_count, Bottle_cost, Cents
            from read_parquet(?, file_row_number=true)
            where Date>=?::date and Date<?::date and Invoice is not null and Cents is not null
            and Bottle_retail between 1 and 100000 and Bottle_count between 1 and 10000
            and Bottle_cost between 1 and 100000
            order by sha256(Invoice),file_row_number limit 2000""",
            [str(source), f"{year}-04-01", f"{year}-05-01"]).fetchall()
        picks = []
        for invoice, row, price, units, cost, cents in rows:
            vector = price, units, cost
            if vector in seen:
                continue
            seen.add(vector)
            picks.append([invoice, row, price, units, cost, cents])
            if len(picks) == count:
                break
        assert len(picks) == count
        groups.append({"year": year, "rows": picks})
data = {"attribution":"Iowa Alcoholic Beverages Division, Iowa Liquor Sales, CC BY 4.0. gatewaycat/iowa-liquor-sales2, 1ee2a06e0d9d0f470607f89417acaaec6bd43607",
        "sourceSha256":expected,"columns":["invoice","parquetRow","retailCents","bottles","costCents","documentedCents"],"periods":groups}
output.write_text(json.dumps(data,separators=(",", ":"))+"\n")
