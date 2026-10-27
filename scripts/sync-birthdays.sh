#!/bin/bash
# Copy birthdays from Apple Contacts (the source of Calendar's "Birthdays" calendar) into the Worker's
# KV as birthdays:contacts. Apple stores a missing birth year as 1604; those get no year.
# Usage: scripts/sync-birthdays.sh        (add --local to fill the local dev store instead)
set -euo pipefail
cd "$(dirname "$0")/.."
WHERE=--remote
[ "${1:-}" = "--local" ] && WHERE=--local
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

osascript -e 'tell application "Contacts"
set out to ""
repeat with p in (every person whose birth date is not missing value)
set d to birth date of p
set out to out & (name of p) & "|" & ((month of d) as integer) & "|" & (day of d) & "|" & (year of d) & linefeed
end repeat
return out
end tell' | python3 -c '
import json, sys
rows = []
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    name, m, d, y = line.split("|")
    row = {"name": name, "date": f"{int(m):02d}-{int(d):02d}"}
    if int(y) > 1900:
        row["year"] = int(y)
    rows.append(row)
json.dump(sorted(rows, key=lambda r: r["date"]), open(sys.argv[1], "w"))
print(f"{len(rows)} birthdays from Contacts")
' "$OUT"
npx wrangler kv key put birthdays:contacts --path "$OUT" --binding LISTS $WHERE >/dev/null
echo "uploaded"
