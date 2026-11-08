import json
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent.parent
LIST_FILE = ROOT / "scripts" / "aesthetics_list.json"
OUT_DIR = ROOT / "docs" / "data" / "trends"
NEEDS_GT_FILE = ROOT / "scripts" / "needs_google_trends.json"

HEADERS = {"User-Agent": "trend-tracker/1.0 (https://github.com/seyounglee2001/trend-tracker)"}
API = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
       "en.wikipedia/all-access/user/{title}/monthly/{start}/{end}")
START = "20150701"              # earliest date Wikimedia has pageview data
USE_SECTION_ARTICLES = False    # True = also use articles where the aesthetic is only a section

# End at the last day of the previous month, so we never save a half-finished month
end = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y%m%d")

aesthetics = json.loads(LIST_FILE.read_text(encoding="utf-8"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

used_titles = {}
needs_google_trends = []
saved = 0

for a in aesthetics:
    slug, name = a["slug"], a["name"]
    title = (a.get("wiki_title") or "").strip()

    # Decide whether this aesthetic has a usable Wikipedia article
    reason = None
    if not a.get("wiki_ok") or not title:
        reason = "no Wikipedia article"
    elif a.get("wiki_section") and not USE_SECTION_ARTICLES:
        reason = f"only a section of '{title}'"
    elif title in used_titles:
        reason = f"same article as {used_titles[title]}"

    if reason:
        print(f"SKIP     {name:<26} {reason}")
        needs_google_trends.append(slug)
        continue
    used_titles[title] = name

    url = API.format(title=quote(title, safe=""), start=START, end=end)
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
    except requests.RequestException as e:
        print(f"ERROR    {name:<26} request failed ({e})")
        needs_google_trends.append(slug)
        continue

    if r.status_code == 404:
        print(f"NO DATA  {name:<26} Wikipedia has no pageviews for '{title}'")
        needs_google_trends.append(slug)
        continue
    if not r.ok:
        print(f"ERROR    {name:<26} HTTP {r.status_code}")
        needs_google_trends.append(slug)
        continue

    points = [
        {"date": f"{i['timestamp'][:4]}-{i['timestamp'][4:6]}", "value": i["views"]}
        for i in r.json().get("items", [])
    ]
    if not points:
        print(f"NO DATA  {name:<26} empty result")
        needs_google_trends.append(slug)
        continue

    out = {
        "slug": slug,
        "name": name,
        "source": "wikipedia",
        "article": title,
        "unit": "monthly page views",
        "updated": date.today().isoformat(),
        "points": points,
    }
    (OUT_DIR / f"{slug}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    saved += 1

    peak = max(points, key=lambda p: p["value"])
    print(f"OK       {name:<26} {len(points):>3} months | "
          f"latest {points[-1]['value']:>8,} | peak {peak['date']} ({peak['value']:,})")
    time.sleep(0.1)  # be polite to Wikimedia

NEEDS_GT_FILE.write_text(json.dumps(needs_google_trends, indent=2), encoding="utf-8")
print(f"\nSaved {saved} trend files to {OUT_DIR}")
print(f"{len(needs_google_trends)} aesthetics need Google Trends data -> {NEEDS_GT_FILE.name}")