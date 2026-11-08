import difflib
import json
import re
from pathlib import Path

from datasets import load_dataset

ROOT = Path(__file__).resolve().parent.parent
LIST_FILE = ROOT / "scripts" / "aesthetics_list.json"
CURATED_FILE = ROOT / "scripts" / "curated.json"
OUT_FILE = ROOT / "docs" / "data" / "catalog.json"


def norm(text):
    """Lowercase and strip punctuation so 'Dark Academia' matches 'dark-academia'."""
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def clean_list(values, limit=10):
    """Remove blanks and duplicates from a list, and cap its length."""
    out, seen = [], set()
    for v in values or []:
        v = str(v).strip(" .,'\"")
        if v and norm(v) not in seen:
            seen.add(norm(v))
            out.append(v)
    return out[:limit]


aesthetics = json.loads(LIST_FILE.read_text(encoding="utf-8"))
curated = json.loads(CURATED_FILE.read_text(encoding="utf-8"))

print("Loading Aesthetics Wiki dataset (downloads once, then cached)...")
rows = load_dataset("ninar12/aesthetics-wiki", split="train")

# Index every dataset row by its title and alternate titles
by_name = {}
for row in rows:
    for name in [row["title"]] + list(row["alt_titles"] or []):
        by_name.setdefault(norm(name), row)
all_names = list(by_name)

catalog, descriptions = [], {}
print("\nMatching aesthetics to the dataset:")
for a in aesthetics:
    key = norm(a.get("aw_title") or a["name"])
    row = by_name.get(key)
    status = "MATCHED"
    if row is None:
        close = difflib.get_close_matches(key, all_names, n=1, cutoff=0.85)
        if close:
            row = by_name[close[0]]
            status = f"FUZZY -> '{row['title']}'"
        else:
            status = "NOT FOUND"
    print(f"  {status:<30} {a['name']}")

    row = row or {}
    c = curated.get(a["slug"], {})
    if not c:
        print(f"  ! No curated entry for '{a['slug']}' - add one to curated.json")

    descriptions[a["slug"]] = (row.get("description") or "").lower()
    catalog.append({
        "slug": a["slug"],
        "name": a["name"],
        "summary": c.get("summary") or row.get("overview") or "",
        "items": c.get("items", []),
        "decade": row.get("extract_decade"),
        "colors": clean_list(row.get("key_colours")),
        "motifs": clean_list(row.get("key_motifs")),
        "brands": clean_list(row.get("related_brands")),
        "values": clean_list(row.get("key_values"), limit=6),
        "fashion_notes": row.get("fashion_sentences") or "",
        "related": c.get("related", []),
        "wiki_title": a.get("wiki_title", ""),
        "has_wiki_data": bool(a.get("wiki_ok")),
        "source_title": row.get("title"),
    })

# Related aesthetics: other aesthetics on your list mentioned in this one's description
for entry in catalog:
    if entry["related"]:
        continue  # you set it by hand in curated.json
    desc = descriptions[entry["slug"]]
    found = []
    for other in catalog:
        if other["slug"] == entry["slug"]:
            continue
        if re.search(r"\b" + re.escape(other["name"].lower()) + r"\b", desc):
            found.append(other["slug"])
    entry["related"] = found[:6]

OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
OUT_FILE.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"\nWrote {len(catalog)} aesthetics to {OUT_FILE}")