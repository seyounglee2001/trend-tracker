import csv
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "google_trends"
LIST_FILE = ROOT / "scripts" / "aesthetics_list.json"
TERMS_FILE = ROOT / "scripts" / "google_trends_terms.json"
BATCH_FILE = ROOT / "scripts" / "google_trends_batches.json"
OUT_DIR = ROOT / "docs" / "data" / "trends"

DATE_FORMATS = ["%Y-%m", "%Y-%m-%d", "%b %Y", "%b %d, %Y", "%B %Y"]


def to_month(text):
    """Turn a date cell like '2015-07', '2015-07-05' or 'Jul 2015' into '2015-07'."""
    text = text.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m")
        except ValueError:
            pass
    return None


def to_number(text):
    text = text.strip()
    if text.startswith("<"):   # Google writes "<1" for tiny values
        return 0.5
    try:
        return float(text)
    except ValueError:
        return None


def read_csv(path):
    """Return {term: {month: value}}, averaging weekly data into months."""
    rows = list(csv.reader(path.open(encoding="utf-8-sig")))
    start = next((i for i, r in enumerate(rows) if r and to_month(r[0])), None)
    if start is None or start == 0:
        raise ValueError(f"{path.name}: couldn't find any dated rows")
    header = rows[start - 1]
    names = [re.sub(r":\s*\(.*\)\s*$", "", h).strip().lower() for h in header[1:]]

    values = defaultdict(lambda: defaultdict(list))
    for row in rows[start:]:
        month = to_month(row[0]) if row else None
        if not month:
            continue
        for name, cell in zip(names, row[1:]):
            x = to_number(cell)
            if x is not None:
                values[name][month].append(x)
    return {n: {m: sum(v) / len(v) for m, v in ms.items()} for n, ms in values.items()}


names = {a["slug"]: a["name"] for a in json.loads(LIST_FILE.read_text(encoding="utf-8"))}
terms = json.loads(TERMS_FILE.read_text(encoding="utf-8"))
batches = json.loads(BATCH_FILE.read_text(encoding="utf-8"))

reference = None
saved = 0
for b in batches:
    path = RAW_DIR / b["file"]
    if not path.exists():
        print(f"MISSING  {b['file']} - download it first")
        continue

    data = read_csv(path)
    anchor = b["anchor"].lower()
    if anchor not in data:
        print(f"ERROR    {b['file']}: anchor '{anchor}' not found. Columns: {list(data)}")
        continue

    # Put this batch on the same scale as the first batch, using the anchor term
    if reference is None:
        reference = data[anchor]
    shared = [m for m in reference if m in data[anchor]]
    batch_total = sum(data[anchor][m] for m in shared)
    scale = sum(reference[m] for m in shared) / batch_total if batch_total else 1.0

    for slug in b["slugs"]:
        term = terms[slug].lower()
        series = data.get(term)
        if series is None:
            print(f"ERROR    {names.get(slug, slug)}: '{term}' not in {b['file']}. Columns: {list(data)}")
            continue

        points = [{"date": m, "value": round(v * scale, 2)} for m, v in sorted(series.items())]
        out = {
            "slug": slug,
            "name": names.get(slug, slug),
            "source": "google_trends",
            "search_term": terms[slug],
            "unit": f"relative search interest (anchor: '{b['anchor']}' peak = 100)",
            "updated": date.today().isoformat(),
            "points": points,
        }
        (OUT_DIR / f"{slug}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
        saved += 1
        peak = max(points, key=lambda p: p["value"])
        print(f"OK       {names.get(slug, slug):<26} peak {peak['date']} ({peak['value']})")

print(f"\nSaved {saved} Google Trends files to {OUT_DIR}")