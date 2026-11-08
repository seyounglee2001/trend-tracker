# Capturing the Trends and Microtrends: From Carolyn Bessette's Elegance to the Ethereal Whimsigoth

Tracking fashion aesthetics over time and forecasting where they're headed.

**Live site:** https://seyounglee2001.github.io/trend-tracker/

Search any aesthetic (grunge, cottagecore, mob wife…) or a clothing piece (Doc Martens, loafers…) to see:

- **What the aesthetic looks like:** a summary, key pieces, color palette and brands
- **How popular the aesthetic has been:** monthly interest since July 2015
- **Where the aesthetic is headed:** a 12-month forecast with a confidence range

---

## Data sources

| What | Source | Used for |
|---|---|---|
| Aesthetic details | [Aesthetics Wiki dataset](https://huggingface.co/datasets/ninar12/aesthetics-wiki) (MIT) | Colors, brands, decade, descriptions |
| Summaries and key pieces | Hand-curated (`scripts/curated.json`) | The main content on each page |
| Popularity | [Wikimedia Pageviews API](https://wikimedia.org/api/rest_v1/) | Aesthetics with a dedicated Wikipedia article |
| Popularity | [Google Trends](https://trends.google.com/) | Aesthetics without one |

---

## Setup

Requires Python 3.11+.

```bash
git clone https://github.com/seyounglee2001/trend-tracker.git
cd trend-tracker
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

---

## Data pipeline

Run every command from the main `trend-tracker` folder.

### 1. Pick the aesthetics.

The starting list of aesthetics, their Wikipedia titles, and the first draft of summaries and key pieces were generated with an AI assistant (Claude). Every entry was then reviewed and edited by hand.

The list lives in two files:

| File | What it holds |
|---|---|
| `scripts/aesthetics_list.json` | Each aesthetic's `slug`, display `name`, Wikipedia title and Aesthetics Wiki title |
| `scripts/curated.json` | Each aesthetic's summary and key pieces, plus optional colors, brands and related aesthetics |

Then check every Wikipedia title:

```bash
python scripts/check_wiki.py
```

It fixes redirects automatically and flags articles that are missing or only a section of a bigger article (Barbiecore, for example, only exists as a section of the *Barbie* article). Those aesthetics use Google Trends instead.

**To add an aesthetic:** add it to the end of both files, then rerun the steps below.

### 2. Build the catalog and the descriptions of the aesthetics.

```bash
python scripts/build_catalog.py
```

Matches each aesthetic to the Aesthetics Wiki dataset and merges in the hand-curated data. Curated values always win. **Output:** `docs/data/catalog.json`

### 3. Fetch Wikipedia trends.

```bash
python scripts/fetch_trends.py
```

Downloads monthly page views from July 2015 to last month for every aesthetic with a dedicated article. Aesthetics without one are written to a to-do list.

**Output:** `docs/data/trends/<aesthetic>.json` and `scripts/needs_google_trends.json`

### 4. Get Google Trends data.

Google Trends has no reliable free API, so this step is a guided manual download.

```bash
python scripts/make_gt_batches.py
```

This prints one link per batch. Google Trends compares at most 5 terms at once, so each batch holds **4 aesthetics plus "dark academia"**.

**Why "dark academia" is in every batch:** Google rescales every comparison so its highest point is 100, so numbers from different batches aren't comparable on their own. Dark academia appears in every batch as a shared reference point. The import script uses it to put all batches on one scale.

For each batch:

1. Open the link. The terms and date range are already filled in.
2. Click the download icon on the **Interest over time** chart.
3. Move and rename the file:
   ```bash
   mv ~/Downloads/multiTimeline.csv data/google_trends/batch_01.csv
   ```

**Example batch:** [dark academia, tomato girl summer, vanilla girl, carolyn bessette style, dakota johnson style](https://trends.google.com/trends/explore?date=2015-07-01%202026-11-08&q=dark%20academia,tomato%20girl%20summer,vanilla%20girl,carolyn%20bessette%20style,dakota%20johnson%20style)

![Google Trends comparison of dark academia (anchor), tomato girl summer, vanilla girl, carolyn bessette style and dakota johnson style, July 2015 to November 2026](assets/google-trends-example.png)

Dark academia (blue) is the anchor. The other four are scaled against it.

Search terms can be edited in `scripts/google_trends_terms.json`. Edit them **before** downloading, then rerun `make_gt_batches.py`.

### 5. Import Google Trends data.

```bash
python scripts/import_google_trends.py
```

Reads every CSV in `data/google_trends/`, rescales each batch using the anchor, and saves one trend file per aesthetic in the same format as the Wikipedia files.

**Output:** `docs/data/trends/<aesthetic>.json`

### 6. Forecast!

```bash
python scripts/forecast.py
```

For each aesthetic this script:

- **Forecasts 12 months ahead** with an exponential smoothing (ETS) model, including an 80% confidence range. Yearly seasonality is used when there are at least 3 years of history.
- **Tests its accuracy** by hiding the last 6 months, forecasting them, and comparing against a simple "nothing changes" guess.
- **Labels the trend** as rising, emerging, peaking, steady, declining or past its peak.

**Output:** forecasts added to each trend file, plus `docs/data/summary.json`

**Always run this last.** Steps 3 and 5 rewrite the trend files without forecasts.

---

## Updating the data

```bash
python scripts/fetch_trends.py
python scripts/forecast.py
git add . && git commit -m "Update trends" && git push
```

To refresh Google Trends too, redo steps 4 and 5 before running `forecast.py`.

---

## Limitations

- Page views and searches measure **attention**, not what people actually wear.
- Wikipedia and Google Trends use **different units**, so compare the shape of charts, not raw numbers across sources.
- A news story or viral video can spike interest without the look catching on.
- Newer aesthetics have short histories, so their forecasts are less certain.

## Project structure

```
trend-tracker/
├── scripts/              # data pipeline
├── data/google_trends/   # downloaded Google Trends CSVs
├── assets/               # images for this README
└── docs/                 # the website
    ├── index.html
    ├── style.css
    ├── app.js
    └── data/
        ├── catalog.json
        ├── summary.json
        └── trends/
```
