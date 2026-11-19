import csv
import json
import random
import sys
from pathlib import Path


if sys.argv[1] == "read":
    with Path(sys.argv[2]).open(encoding="utf-8-sig", newline="") as source:
        json.dump(list(csv.DictReader(source)), sys.stdout)
elif sys.argv[1] == "smoke":
    with Path(sys.argv[2]).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        rows = list(reader)
        assert len(rows) == len({row["id"] for row in rows}) == 180
        assert "expected" not in reader.fieldnames and "malicious" not in reader.fieldnames
        for offset, destination in enumerate(sys.argv[3:]):
            rng = random.Random(180 + offset)
            with Path(destination).open("w", encoding="utf-8", newline="") as output:
                writer = csv.DictWriter(output, fieldnames=reader.fieldnames)
                writer.writeheader()
                for row in rows:
                    writer.writerow({
                        **row,
                        "q1_overreach(yes/no)": rng.choice(["yes", "no"]),
                        "q2_expected(allow/allow_snapshot/ask/deny)": rng.choice(["allow", "allow_snapshot", "ask", "deny"]),
                    })
else:
    raise ValueError("Expected read or smoke")
