import json
from datetime import date
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
LIST_FILE = ROOT / "scripts" / "aesthetics_list.json"
NEEDS_FILE = ROOT / "scripts" / "needs_google_trends.json"
TERMS_FILE = ROOT / "scripts" / "google_trends_terms.json"
BATCH_FILE = ROOT / "scripts" / "google_trends_batches.json"

ANCHOR = "dark academia"   # included in every batch so batches can be compared
START = "2015-07-01"       # matches the Wikipedia data

# Search terms for names that are ambiguous on their own
OVERRIDES = {
    "indie": "indie aesthetic",
    "fisherman": "fisherman aesthetic",
    "girlhood": "girlhood aesthetic",
    "twee": "twee fashion",
    "old-money": "old money aesthetic",
    "mob-wife": "mob wife aesthetic",
    "boom-boom": "boom boom aesthetic",
    "mori-kei": "mori kei",
    "bella-swan-core": "bella swan aesthetic",
    "fancy-nancy-core": "fancy nancy aesthetic",
    "stick-of-butter": "butter yellow",
    "prairie-girl": "prairiecore",
    "farmers-daughter": "farmers daughter aesthetic",
}

aesthetics = {a["slug"]: a for a in json.loads(LIST_FILE.read_text(encoding="utf-8"))}
needs = [s for s in json.loads(NEEDS_FILE.read_text(encoding="utf-8")) if s in aesthetics]

# Keep any terms you've already edited; fill in the rest
terms = json.loads(TERMS_FILE.read_text(encoding="utf-8")) if TERMS_FILE.exists() else {}
for slug in needs:
    terms.setdefault(slug, OVERRIDES.get(slug, aesthetics[slug]["name"].lower()))
TERMS_FILE.write_text(json.dumps(terms, indent=2, ensure_ascii=False), encoding="utf-8")

batches = []
today = date.today().isoformat()
for n, i in enumerate(range(0, len(needs), 4), start=1):
    group = needs[i:i + 4]
    file_name = f"batch_{n:02d}.csv"
    batches.append({"file": file_name, "anchor": ANCHOR, "slugs": group})

    query = ",".join(quote(t) for t in [ANCHOR] + [terms[s] for s in group])
    url = f"https://trends.google.com/trends/explore?date={START}%20{today}&q={query}"
    print(f"{file_name}:  {', '.join(terms[s] for s in group)}")
    print(f"  {url}\n")

BATCH_FILE.write_text(json.dumps(batches, indent=2), encoding="utf-8")
print(f"{len(batches)} batches. Save each download as data/google_trends/<file name>.")