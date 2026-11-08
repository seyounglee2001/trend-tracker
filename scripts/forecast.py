import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import AutoETS

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
TRENDS_DIR = ROOT / "docs" / "data" / "trends"
SUMMARY_FILE = ROOT / "docs" / "data" / "summary.json"

HORIZON = 12   # months to forecast
HOLDOUT = 6    # months hidden for the accuracy test
LEVEL = 80     # width of the confidence range (%)


def fit_ets(values, start, h, season):
    """Fit an ETS model and return (forecast, low, high) arrays."""
    df = pd.DataFrame({
        "unique_id": "s",
        "ds": pd.date_range(start, periods=len(values), freq="MS"),
        "y": values,
    })
    sf = StatsForecast(models=[AutoETS(season_length=season, alias="ets")], freq="MS")
    fc = sf.forecast(df=df, h=h, level=[LEVEL])
    return (fc["ets"].to_numpy(),
            fc[f"ets-lo-{LEVEL}"].to_numpy(),
            fc[f"ets-hi-{LEVEL}"].to_numpy())


def safe_forecast(values, start, h):
    """Try a seasonal model, then a non-seasonal one, then a simple fallback."""
    seasons = [12, 1] if len(values) >= 36 else [1]
    for season in seasons:
        try:
            return fit_ets(values, start, h, season), f"ETS (season={season})"
        except Exception:
            pass
    last = values[-1]
    spread = float(np.std(np.diff(values))) if len(values) > 2 else 0.0
    mean = np.full(h, last)
    return (mean, mean - 1.28 * spread, mean + 1.28 * spread), "naive fallback"


def growth(new, old):
    return float(new / old - 1) if old > 0 else None


def label(n_months, yoy, fc_growth, pct_of_peak):
    yoy = yoy or 0
    fc_growth = fc_growth or 0
    if yoy > 0.15 and fc_growth > 0.05:
        return "emerging" if n_months < 24 else "rising"
    if yoy < -0.15 and fc_growth < -0.05:
        return "declining"
    if pct_of_peak >= 0.75:
        return "peaking"
    if pct_of_peak < 0.25:
        return "faded"
    return "stable"


summary = []
for path in sorted(TRENDS_DIR.glob("*.json")):
    data = json.loads(path.read_text(encoding="utf-8"))
    points = data.get("points", [])
    values = np.array([p["value"] for p in points], dtype=float)
    name = data.get("name", path.stem)

    if len(values) < 12 or values.sum() == 0:
        data.update(forecast=[], status="not enough data", metrics={}, model=None)
        path.write_text(json.dumps(data, indent=1), encoding="utf-8")
        summary.append({"slug": data["slug"], "name": name, "source": data.get("source"),
                        "status": "not enough data"})
        print(f"SKIP  {name:<26} not enough data")
        continue

    start = pd.Timestamp(points[0]["date"] + "-01")
    last = pd.Timestamp(points[-1]["date"] + "-01")

    # 1. Forecast the next 12 months
    (mean, lo, hi), model = safe_forecast(values, start, HORIZON)
    future = pd.date_range(last + pd.offsets.MonthBegin(1), periods=HORIZON, freq="MS")
    data["forecast"] = [
        {"date": d.strftime("%Y-%m"),
         "value": round(max(float(m), 0), 2),
         "lo": round(max(float(l), 0), 2),
         "hi": round(max(float(u), 0), 2)}
        for d, m, l, u in zip(future, mean, lo, hi)
    ]
    data["model"] = model

    # 2. Accuracy test: hide the last 6 months and forecast them
    skill = None
    if len(values) >= HOLDOUT + 24:
        train, actual = values[:-HOLDOUT], values[-HOLDOUT:]
        (pred, _, _), _ = safe_forecast(train, start, HOLDOUT)
        mae_model = float(np.mean(np.abs(np.maximum(pred, 0) - actual)))
        mae_naive = float(np.mean(np.abs(train[-1] - actual)))
        skill = round(1 - mae_model / mae_naive, 3) if mae_naive > 0 else None

    # 3. Trend status
    recent = values[-6:].mean()
    year_ago = values[-18:-12].mean() if len(values) >= 18 else values[:6].mean()
    yoy = growth(recent, year_ago)
    fc_growth = growth(np.maximum(mean, 0).mean(), values[-12:].mean())
    pct_of_peak = float(recent / values.max())
    status = label(len(values), yoy, fc_growth, pct_of_peak)

    data["status"] = status
    data["metrics"] = {
        "yoy_growth": None if yoy is None else round(yoy, 3),
        "forecast_growth": None if fc_growth is None else round(fc_growth, 3),
        "pct_of_peak": round(pct_of_peak, 3),
        "peak_date": points[int(values.argmax())]["date"],
        "backtest_skill": skill,
    }
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")

    summary.append({"slug": data["slug"], "name": name, "source": data.get("source"),
                    "status": status, **data["metrics"]})

    fmt = lambda x: "  n/a" if x is None else f"{x:+.0%}"
    print(f"{status.upper():<10} {name:<26} yoy {fmt(yoy):>6} | next 12m {fmt(fc_growth):>6} | "
          f"skill {'n/a' if skill is None else f'{skill:+.2f}'} | {model}")

summary.sort(key=lambda s: s.get("forecast_growth") or -9, reverse=True)
SUMMARY_FILE.write_text(json.dumps(summary, indent=1), encoding="utf-8")

skills = [s["backtest_skill"] for s in summary if s.get("backtest_skill") is not None]
statuses = pd.Series([s["status"] for s in summary]).value_counts()
print(f"\nForecast {len(summary)} aesthetics -> {SUMMARY_FILE.name}")
print("Status counts:", dict(statuses))
if skills:
    beat = sum(s > 0 for s in skills)
    print(f"Beat the naive baseline on {beat}/{len(skills)} aesthetics "
          f"(median skill {np.median(skills):+.2f})")