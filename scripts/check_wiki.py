import json
import time
from pathlib import Path

import requests

LIST_FILE = Path(__file__).parent / "aesthetics_list.json"
API = "https://en.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "trend-tracker (seyounglee2001@gmail.com)"}

aesthetics = json.loads(LIST_FILE.read_text(encoding="utf-8"))

for a in aesthetics:
    title = (a.get("wiki_title") or "").strip()

    if not title:
        print(f"BLANK     {a.get('name')}: no wiki_title filled in")
        a["wiki_ok"] = False
        continue

    params = {"action": "query", "titles": title, "redirects": 1, "format": "json"}
    try:
        data = requests.get(API, params=params, headers=HEADERS, timeout=30).json()
    except Exception as e:
        print(f"ERROR     {a.get('name')}: request failed ({e})")
        a["wiki_ok"] = False
        continue

    query = data.get("query")
    if not query:
        print(f"ERROR     {a.get('name')}: unexpected reply for '{title}': {data}")
        a["wiki_ok"] = False
        continue

    page = next(iter(query["pages"].values()))

    if "invalid" in page:
        print(f"INVALID   {a.get('name')}: '{title}' isn't a valid title ({page.get('invalidreason')})")
        a["wiki_ok"] = False
        continue

    if "missing" in page:
        print(f"MISSING   {a.get('name')}: no article called '{title}'")
        a["wiki_ok"] = False
        continue

    resolved = page["title"].replace(" ", "_")
    redirect = (query.get("redirects") or [{}])[0]

    if redirect.get("tofragment"):
        print(f"SECTION   {a.get('name')}: redirects to a section of '{resolved}' "
              f"(#{redirect['tofragment']}) - views would cover the whole article")
        a["wiki_section"] = True
    elif resolved != title:
        print(f"REDIRECT  {a.get('name')}: '{title}' -> '{resolved}' (fixed)")
    else:
        print(f"OK        {a.get('name')}: {resolved}")

    a["wiki_title"] = resolved
    a["wiki_ok"] = True
    time.sleep(0.2)  # be polite to Wikipedia's servers

LIST_FILE.write_text(json.dumps(aesthetics, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"\nSaved updated list to {LIST_FILE}")