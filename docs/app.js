/* Trend Tracker
   Reads the JSON your Python scripts write into docs/data/ and renders:
   #/            home: search + what's moving
   #/t/<slug>    one aesthetic: chart, forecast, pieces, palette
   #/index       A to Z with status filters
   #/about       sources and method
*/

const state = {
  catalog: [],
  bySlug: new Map(),
  summary: [],
  summaryBySlug: new Map(),
  trends: new Map(),
};

const app = document.getElementById("app");
let firstRoute = true;
let activeChart = null; // { el, trend, observer }

const STATUS = {
  rising:            { label: "Rising",        mark: "↑" },
  emerging:          { label: "Emerging",      mark: "↑" },
  peaking:           { label: "At its peak",   mark: "•" },
  stable:            { label: "Steady",        mark: "→" },
  declining:         { label: "Declining",     mark: "↓" },
  faded:             { label: "Past its peak", mark: "↓" },
  "not enough data": { label: "Not enough data", mark: "" },
};

/* ---------- Helpers ---------- */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const monthFmt = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });
const longMonthFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const toDate = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1);
};

function fmtPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "n/a";
  const v = Math.round(x * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function isWiki(trend) {
  return trend && trend.source === "wikipedia";
}

function fmtValue(v, trend) {
  if (isWiki(trend)) return compactFmt.format(Math.round(v));
  if (v === 0) return "0";
  return v >= 10 ? Math.round(v).toString() : v.toFixed(1);
}

function unitWord(trend) {
  return isWiki(trend) ? "page views" : "search interest";
}

function statusInfo(key) {
  return STATUS[key] || { label: "No trend data", mark: "" };
}

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function getTrend(slug) {
  if (!state.trends.has(slug)) {
    state.trends.set(slug, getJSON(`data/trends/${encodeURIComponent(slug)}.json`).catch(() => null));
  }
  return state.trends.get(slug);
}

/* Turn names like "dark green", "Camel" or "Pastel pinks" into a CSS color, or null */
const COLOR_WORDS = {
  camel: "#c19a6b", cream: "#f2ead8", burgundy: "#7d1d2f", denim: "#5b7396", sage: "#9caf88",
  mint: "#aee3c8", lilac: "#c8a2c8", mustard: "#d9a400", charcoal: "#36454f", nude: "#e3bc9a",
  blush: "#de98a8", champagne: "#f1dfc1", rust: "#b7410e", emerald: "#2e8b57", butter: "#f3e3a0",
  neon: "#39ff14", pastel: "#f6c6d8", mauve: "#b784a7", taupe: "#8b8589", ivory: "#fffff0",
  oatmeal: "#e5d9c3", chocolate: "#5a3a29", wine: "#722f37", forest: "#2f4f3a", earth: "#8a6a4a",
  rose: "#e8a5b3", baby: "#bfe1f5", bubblegum: "#ff8fc7", cherry: "#c1121f", olive: "#708238",
};
const colorCache = new Map();
function cssColor(name) {
  if (colorCache.has(name)) return colorCache.get(name);
  const words = norm(name).split(" ").filter(Boolean);
  let result = null;
  const tryColor = (c) => (c && CSS.supports("color", c) ? c : null);
  result = tryColor(words.join(""));
  if (!result) {
    for (const w of [...words].reverse()) {
      const base = w.replace(/s$/, "");
      result = COLOR_WORDS[w] || COLOR_WORDS[base] || tryColor(w) || tryColor(base);
      if (result) break;
    }
  }
  colorCache.set(name, result);
  return result;
}

function paletteOf(a) {
  const seen = new Set();
  const out = [];
  for (const name of a.colors || []) {
    const c = cssColor(name);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push({ name, css: c });
    }
  }
  return out;
}

/* ---------- Search ---------- */

function searchAesthetics(query) {
  const q = norm(query);
  if (!q) return [];
  const results = [];
  for (const a of state.catalog) {
    const n = norm(a.name);
    let score = 0;
    let via = null;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.split(" ").some((w) => w.startsWith(q))) score = 70;
    else if (n.includes(q)) score = 60;
    if (!score) {
      const item = (a.items || []).find((i) => norm(i).includes(q));
      if (item) { score = 40; via = item; }
    }
    if (!score) {
      const brand = (a.brands || []).find((b) => norm(b).includes(q));
      if (brand) { score = 30; via = brand; }
    }
    if (score) results.push({ slug: a.slug, name: a.name, score, via });
  }
  return results.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name)).slice(0, 8);
}

function mountSearch(container, size) {
  const id = `search-${size}`;
  container.innerHTML = `
    <form class="search search--${size}" role="search" autocomplete="off">
      <label class="visually-hidden" for="${id}-input">Search aesthetics, clothing pieces or brands</label>
      <input class="search__input" id="${id}-input" type="search" spellcheck="false"
        placeholder="${size === "large" ? "Search an aesthetic or a piece, like grunge or loafers" : "Search trends"}"
        role="combobox" aria-expanded="false" aria-controls="${id}-list" aria-autocomplete="list">
      <svg class="search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21" stroke-linecap="round"/>
      </svg>
      <ul class="search__list" id="${id}-list" role="listbox" hidden></ul>
    </form>`;

  const form = container.querySelector("form");
  const input = container.querySelector("input");
  const list = container.querySelector("ul");
  let results = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const render = () => {
    const q = input.value.trim();
    if (!q) return close();
    if (!results.length) {
      list.innerHTML = `<li class="search__empty" role="option" aria-disabled="true">Nothing matches “${esc(q)}”. Try a clothing piece, like flannel, or a brand.</li>`;
    } else {
      list.innerHTML = results
        .map((r, i) => {
          const s = state.summaryBySlug.get(r.slug);
          return `<li class="search__option" id="${id}-opt-${i}" role="option" aria-selected="${i === active}" data-index="${i}">
            <span><span class="search__name">${esc(r.name)}</span>
            ${r.via ? `<span class="search__via">Features ${esc(r.via)}</span>` : ""}</span>
            ${s ? `<span class="search__status">${esc(statusInfo(s.status).label)}</span>` : ""}
          </li>`;
        })
        .join("");
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", `${id}-opt-${active}`);
      list.querySelector(`#${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const go = (r) => {
    if (!r) return;
    input.value = "";
    close();
    input.blur();
    location.hash = `#/t/${r.slug}`;
  };

  input.addEventListener("input", () => {
    results = searchAesthetics(input.value);
    active = results.length ? 0 : -1;
    render();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      active = (active + 1) % results.length;
      render();
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
      render();
    } else if (e.key === "Escape") {
      close();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    go(results[active] || results[0]);
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest("[data-index]");
    if (opt) {
      e.preventDefault();
      go(results[Number(opt.dataset.index)]);
    }
  });

  input.addEventListener("focus", () => { if (input.value.trim()) render(); });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

/* ---------- Sparklines ---------- */

function sparkSVG(trend, w = 96, h = 28) {
  if (!trend || !trend.points?.length) return "";
  const hist = trend.points.slice(-36).map((p) => p.value);
  const fc = (trend.forecast || []).map((p) => p.value);
  const all = hist.concat(fc);
  const max = Math.max(...all, 1e-9);
  const n = all.length;
  const x = (i) => (i / (n - 1)) * w;
  const y = (v) => h - 2 - (v / max) * (h - 4);
  const histPath = hist.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const fcPath = fc.length
    ? `M${x(hist.length - 1).toFixed(1)},${y(hist.at(-1)).toFixed(1)}` +
      fc.map((v, i) => `L${x(hist.length + i).toFixed(1)},${y(v).toFixed(1)}`).join("")
    : "";
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" preserveAspectRatio="none">
    <path d="${histPath}" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${fcPath ? `<path d="${fcPath}" fill="none" stroke="#8f8f8f" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ""}
  </svg>`;
}

function hydrateSparks(root = app) {
  root.querySelectorAll("[data-spark]").forEach(async (el) => {
    const t = await getTrend(el.dataset.spark);
    if (t) el.innerHTML = sparkSVG(t);
  });
}

/* ---------- Big chart ---------- */

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * p >= v) return s * p;
  return 10 * p;
}

function drawChart(el, trend) {
  const hist = trend.points.map((p) => ({ d: toDate(p.date), v: p.value, label: p.date }));
  const fc = (trend.forecast || []).map((p) => ({ d: toDate(p.date), v: p.value, lo: p.lo, hi: p.hi, label: p.date, forecast: true }));
  if (hist.length < 2) {
    el.innerHTML = `<p class="chart__msg">Not enough history to draw a chart yet.</p>`;
    return;
  }

  const W = Math.max(el.clientWidth, 300);
  const narrow = W < 600;
  const H = narrow ? 260 : 380;
  const m = { t: 30, r: 12, b: 34, l: narrow ? 38 : 52 };
  const last = hist.at(-1);
  const x0 = hist[0].d.getTime();
  const x1 = (fc.at(-1) || last).d.getTime();
  const ymax = niceMax(Math.max(...hist.map((p) => p.v), ...fc.map((p) => p.hi ?? p.v)));

  const X = (d) => m.l + ((d.getTime() - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - v / ymax) * (H - m.t - m.b);

  // Gridlines + y labels
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = (ymax / 4) * i;
    const y = Y(v).toFixed(1);
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${i === 0 ? "#000" : "#ececec"}" stroke-width="1"/>
      <text x="${m.l - 8}" y="${y}" dy="0.32em" text-anchor="end" font-size="11" fill="#8f8f8f">${fmtValue(v, trend)}</text>`;
  }

  // Year ticks
  const firstYear = hist[0].d.getFullYear() + (hist[0].d.getMonth() > 0 ? 1 : 0);
  const lastYear = new Date(x1).getFullYear();
  const span = lastYear - firstYear;
  const step = narrow ? (span > 6 ? 3 : 2) : span > 9 ? 2 : 1;
  let xticks = "";
  for (let yr = firstYear; yr <= lastYear; yr += step) {
    const x = X(new Date(yr, 0, 1)).toFixed(1);
    xticks += `<line x1="${x}" x2="${x}" y1="${H - m.b}" y2="${H - m.b + 5}" stroke="#000"/>
      <text x="${x}" y="${H - m.b + 20}" text-anchor="middle" font-size="11" fill="#8f8f8f">${yr}</text>`;
  }

  // Paths
  const histPath = hist.map((p, i) => `${i ? "L" : "M"}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  let fcPath = "";
  let band = "";
  let nowLine = "";
  if (fc.length) {
    fcPath = `M${X(last.d).toFixed(1)},${Y(last.v).toFixed(1)}` + fc.map((p) => `L${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
    const upper = [`${X(last.d).toFixed(1)},${Y(last.v).toFixed(1)}`, ...fc.map((p) => `${X(p.d).toFixed(1)},${Y(p.hi ?? p.v).toFixed(1)}`)];
    const lower = fc.map((p) => `${X(p.d).toFixed(1)},${Y(p.lo ?? p.v).toFixed(1)}`).reverse();
    band = `<polygon points="${upper.concat(lower).join(" ")}" fill="#efefef"/>`;
    const nx = X(last.d).toFixed(1);
    const roomRight = W - m.r - Number(nx) > 84;
    nowLine = `<line x1="${nx}" x2="${nx}" y1="${m.t - 14}" y2="${H - m.b}" stroke="#bdbdbd" stroke-dasharray="2 3"/>
      <text x="${Number(nx) + (roomRight ? 8 : -8)}" y="${m.t - 6}" text-anchor="${roomRight ? "start" : "end"}" font-size="11" font-weight="600" fill="#000" letter-spacing="0.08em">FORECAST</text>`;
  }

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="${esc(trend.name)}: ${esc(unitWord(trend))} by month from ${monthFmt.format(hist[0].d)} to ${monthFmt.format(last.d)}${fc.length ? ", with a 12-month forecast" : ""}.">
      ${grid}
      ${band}
      ${nowLine}
      <path d="${histPath}" fill="none" stroke="#000" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${fcPath ? `<path d="${fcPath}" fill="none" stroke="#6b6b6b" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round"/>` : ""}
      ${xticks}
      <g class="hover" visibility="hidden">
        <line class="hover__line" y1="${m.t}" y2="${H - m.b}" stroke="#000" stroke-width="1"/>
        <circle class="hover__dot" r="4.5" fill="#000" stroke="#fff" stroke-width="2"/>
      </g>
      <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/>
    </svg>
    <div class="chart__tip" hidden></div>`;

  // Hover layer
  const svg = el.querySelector("svg");
  const hover = svg.querySelector(".hover");
  const line = svg.querySelector(".hover__line");
  const dot = svg.querySelector(".hover__dot");
  const tip = el.querySelector(".chart__tip");
  const pts = hist.concat(fc);

  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = pts[0];
    let bestDist = Infinity;
    for (const p of pts) {
      const dist = Math.abs(X(p.d) - px);
      if (dist < bestDist) { best = p; bestDist = dist; }
    }
    const x = X(best.d);
    const y = Y(best.v);
    hover.setAttribute("visibility", "visible");
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    dot.setAttribute("cx", x); dot.setAttribute("cy", y);
    dot.setAttribute("fill", best.forecast ? "#6b6b6b" : "#000");

    tip.innerHTML = best.forecast
      ? `<strong>${monthFmt.format(best.d)}, forecast</strong>${fmtValue(best.v, trend)} ${unitWord(trend)}<br><span>Likely ${fmtValue(best.lo, trend)} to ${fmtValue(best.hi, trend)}</span>`
      : `<strong>${monthFmt.format(best.d)}</strong>${fmtValue(best.v, trend)} ${unitWord(trend)}`;
    tip.hidden = false;
    const scale = rect.width / W;
    const tipW = tip.offsetWidth;
    let left = x * scale + 14;
    if (left + tipW > rect.width) left = x * scale - tipW - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, y * scale - 70)}px`;
  };
  const hide = () => {
    hover.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };

  const hit = svg.querySelector(".hit");
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerdown", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);
}

function mountChart(el, trend) {
  if (activeChart?.observer) activeChart.observer.disconnect();
  let lastW = 0;
  let frame = 0;
  const observer = new ResizeObserver(() => {
    const w = el.clientWidth;
    if (Math.abs(w - lastW) < 2) return;
    lastW = w;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => drawChart(el, trend));
  });
  observer.observe(el);
  activeChart = { el, trend, observer };
}

function dataTable(trend) {
  const rows = trend.points
    .map((p) => `<tr><td>${monthFmt.format(toDate(p.date))}</td><td>${fmtValue(p.value, trend)}</td><td></td></tr>`)
    .concat(
      (trend.forecast || []).map(
        (p) => `<tr><td>${monthFmt.format(toDate(p.date))} (forecast)</td><td>${fmtValue(p.value, trend)}</td><td>${fmtValue(p.lo, trend)} to ${fmtValue(p.hi, trend)}</td></tr>`
      )
    )
    .join("");
  return `<details class="table-toggle">
    <summary>View the numbers as a table</summary>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Month</th><th scope="col">${isWiki(trend) ? "Page views" : "Search interest"}</th><th scope="col">Forecast range</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </details>`;
}

/* ---------- Pages ---------- */

function setPage(name, title) {
  document.body.dataset.page = name;
  document.title = title ? `${title} | Trend Tracker` : "Trend Tracker";
  document.querySelectorAll(".site-nav a").forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (activeChart?.observer) { activeChart.observer.disconnect(); activeChart = null; }
}

/* Photos that drift out from behind the home headline.
   Add or swap photos in docs/img/hero/ and list them here. */
const HERO_PHOTOS = [
  "img/hero/look-1.webp",
  "img/hero/look-2.webp",
  "img/hero/look-3.webp",
  "img/hero/look-4.webp",
];
const HERO_LOOP_SECONDS = 18;

function heroPhotosHTML() {
  // One slot per photo (up to 6), spaced evenly through the loop
  const photos = HERO_PHOTOS.slice(0, 6);
  return photos
    .map((src, i) => {
      const delay = -((i * HERO_LOOP_SECONDS) / photos.length).toFixed(2);
      return `<span class="drift drift--${i}" style="--delay:${delay}s"><img src="${esc(src)}" alt="" decoding="async"></span>`;
    })
    .join("");
}

function rowHTML(s, { showChange = true } = {}) {
  return `<li><a class="row" href="#/t/${esc(s.slug)}">
    <span class="row__name">${esc(s.name)}</span>
    <span class="row__spark" data-spark="${esc(s.slug)}"></span>
    ${showChange ? `<span class="row__change">${fmtPct(s.forecast_growth)}</span>` : ""}
  </a></li>`;
}

function renderHome() {
  setPage("home");
  const live = state.summary.filter((s) => s.status && s.status !== "not enough data");
  const by = (fn) => (a, b) => fn(a) - fn(b);

  const rising = live
    .filter((s) => s.status === "rising" || s.status === "emerging")
    .sort(by((s) => -(s.forecast_growth ?? -9)))
    .slice(0, 6);
  const peaking = live
    .filter((s) => s.status === "peaking")
    .sort(by((s) => -(s.pct_of_peak ?? 0)))
    .slice(0, 6);
  const cooling = live
    .filter((s) => s.status === "declining" || s.status === "faded")
    .sort(by((s) => s.forecast_growth ?? 9))
    .slice(0, 6);

  const col = (title, note, items) => `
    <div class="movers__col">
      <h3 class="movers__head">${title}</h3>
      <p class="movers__note">${note}</p>
      ${items.length ? `<ul class="rows">${items.map((s) => rowHTML(s)).join("")}</ul>` : `<p class="movers__note">Nothing in this group right now.</p>`}
    </div>`;

  app.innerHTML = `
    <section class="hero">
      <div class="hero__photos" aria-hidden="true">${heroPhotosHTML()}</div>
      <div class="hero__inner">
        <p class="hero__kicker">${state.catalog.length} aesthetics. Real people. Real outfits.</p>
        <h1 class="hero__title">track the<em>aesthetics</em></h1>
        <div id="hero-search"></div>
      </div>
    </section>

    <section class="movers container" aria-labelledby="movers-title">
      <h2 class="section-title" id="movers-title">What’s moving now</h2>
      <p class="section-dek">The percentage beside each aesthetic is its forecast change over the next 12 months, compared with the last 12.</p>
      <div class="movers__grid">
        ${col("Rising", "Up on a year ago and forecast to keep climbing.", rising)}
        ${col("At its peak", "Close to the most attention it has ever had.", peaking)}
        ${col("Cooling off", "Down on a year ago, or well past its peak.", cooling)}
      </div>
      <div class="movers__all"><a class="btn" href="#/index">Browse all ${state.catalog.length} aesthetics</a></div>
    </section>`;

  mountSearch(document.getElementById("hero-search"), "large");
  hydrateSparks();
}

async function renderDetail(slug) {
  const a = state.bySlug.get(slug);
  if (!a) return renderNotFound();
  setPage("detail", a.name);

  const s = state.summaryBySlug.get(slug);
  const st = statusInfo(s?.status);
  const statusClass = s?.status ? `status--${s.status.replace(/\s+/g, "-")}` : "status--none";
  const palette = paletteOf(a);

  // Pieces shared with other aesthetics
  const also = (item) => {
    const n = norm(item);
    return state.catalog
      .filter((o) => o.slug !== slug && (o.items || []).some((i) => norm(i) === n))
      .slice(0, 2);
  };

  const related = (a.related || []).map((r) => state.bySlug.get(r)).filter(Boolean).slice(0, 6);
  const notes = (a.fashion_notes || "").trim();
  const shortNotes = notes.length > 600 ? `${notes.slice(0, 600).replace(/\s+\S*$/, "")}…` : notes;

  app.innerHTML = `
    <article class="trend">
      <header class="trend__head">
        <a class="crumb" href="#/index">All aesthetics</a>
        <h1 class="trend__title">${esc(a.name)}</h1>
        ${a.summary ? `<p class="trend__dek">${esc(a.summary)}</p>` : ""}
        <div class="trend__meta">
          <span class="status ${statusClass}">${st.mark ? `<span aria-hidden="true">${st.mark}</span>` : ""}${esc(st.label)}</span>
          ${a.decade ? `<span>Originated in the ${esc(a.decade)}</span>` : ""}
          <span id="source-line"></span>
        </div>
      </header>

      <section class="block" aria-labelledby="chart-title">
        <h2 class="block__title" id="chart-title">Interest over time</h2>
        <p class="block__sub" id="chart-sub"></p>
        <div class="chart" id="chart"><p class="chart__msg">Loading trend data…</p></div>
        <div id="chart-extra"></div>
        <div class="stats" id="stats"></div>
      </section>

      <section class="block split">
        <div>
          <h2 class="block__title">Key pieces</h2>
          ${(a.items || []).length
            ? `<ul class="pieces">${a.items
                .map((item) => {
                  const others = also(item);
                  return `<li><span>${esc(item)}</span>${
                    others.length
                      ? `<span class="pieces__also">Also in ${others.map((o) => `<a href="#/t/${esc(o.slug)}">${esc(o.name)}</a>`).join(", ")}</span>`
                      : ""
                  }</li>`;
                })
                .join("")}</ul>`
            : `<p class="block__sub">No pieces listed yet. Add them in scripts/curated.json.</p>`}
        </div>
        <div>
          <h2 class="block__title">Palette</h2>
          ${palette.length
            ? `<div class="palette">${palette
                .map((c) => `<div><div class="swatch__chip" style="background:${c.css}"></div><div class="swatch__name">${esc(c.name)}</div></div>`)
                .join("")}</div>`
            : `<p class="block__sub">No palette recorded for this aesthetic.</p>`}
          ${(a.brands || []).length ? `<p class="brands"><strong>Brands:</strong> ${a.brands.map(esc).join(", ")}</p>` : ""}
        </div>
      </section>

      ${shortNotes && a.source_title
        ? `<section class="block block--text">
            <h2 class="block__title">On the look</h2>
            <blockquote class="notes">${esc(shortNotes)}</blockquote>
            <p class="notes__credit">From the Aesthetics Wiki entry “${esc(a.source_title)}”, via the Aesthetics Wiki dataset (MIT).</p>
          </section>`
        : ""}

      ${related.length
        ? `<section class="block">
            <h2 class="block__title">Related aesthetics</h2>
            <ul class="related">${related
              .map((r) => `<li><a class="row" href="#/t/${esc(r.slug)}"><span class="row__name">${esc(r.name)}</span><span class="row__spark" data-spark="${esc(r.slug)}"></span></a></li>`)
              .join("")}</ul>
          </section>`
        : ""}
      <div class="trend__end"></div>
    </article>`;

  hydrateSparks();

  const trend = await getTrend(slug);
  if (location.hash !== `#/t/${slug}`) return; // user moved on while loading

  const chartEl = document.getElementById("chart");
  if (!trend || !trend.points?.length) {
    chartEl.innerHTML = `<p class="chart__msg">There’s no popularity data for ${esc(a.name)} yet.</p>`;
    return;
  }

  const updated = trend.updated ? longMonthFmt.format(new Date(trend.updated)) : null;
  document.getElementById("source-line").textContent = isWiki(trend)
    ? `Wikipedia page views for “${trend.article.replace(/_/g, " ")}”${updated ? `, updated ${updated}` : ""}`
    : `Google search interest for “${trend.search_term}”${updated ? `, updated ${updated}` : ""}`;
  document.getElementById("chart-sub").textContent = isWiki(trend)
    ? "Monthly views of its Wikipedia article, with a forecast for the next 12 months."
    : "Monthly Google search interest on a relative scale, with a forecast for the next 12 months.";

  drawChart(chartEl, trend);
  mountChart(chartEl, trend);

  document.getElementById("chart-extra").innerHTML = `
    ${trend.forecast?.length ? `<p class="chart__caption">The dashed line is the forecast. The shaded band is the range the model expects the real value to fall in 8 times out of 10.</p>` : ""}
    ${dataTable(trend)}`;

  const mtr = trend.metrics || {};
  const skill = mtr.backtest_skill;
  const stat = (label, value, note) => `
    <div class="stat"><p class="stat__label">${label}</p><p class="stat__value">${value}</p>${note ? `<p class="stat__note">${note}</p>` : ""}</div>`;
  document.getElementById("stats").innerHTML = [
    stat("Now vs. a year ago", fmtPct(mtr.yoy_growth), "Last 6 months, same months last year"),
    stat("Next 12 months", fmtPct(mtr.forecast_growth), "Forecast vs. the past 12 months"),
    stat("All-time peak", mtr.peak_date ? monthFmt.format(toDate(mtr.peak_date)) : "n/a",
      mtr.pct_of_peak != null ? `Now at ${Math.round(mtr.pct_of_peak * 100)}% of that peak` : ""),
    stat("Forecast accuracy",
      skill == null ? "n/a" : `${Math.round(Math.abs(skill) * 100)}%`,
      skill == null ? "Not enough history to test" : skill > 0 ? "Less error than a “no change” guess, tested on the last 6 months" : "More error than a “no change” guess, tested on the last 6 months"),
  ].join("");
}

function renderIndex() {
  setPage("index", "All aesthetics");
  const order = ["all", "rising", "emerging", "peaking", "stable", "declining", "faded"];
  const counts = { all: state.catalog.length };
  for (const a of state.catalog) {
    const k = state.summaryBySlug.get(a.slug)?.status;
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  const filters = order.filter((k) => k === "all" || counts[k]);

  app.innerHTML = `
    <header class="page-head">
      <h1 class="page-title">All aesthetics</h1>
      <p class="page-dek">From mob wife to menocore: every look we track, with where it stands right now.</p>
      <div class="filters" role="group" aria-label="Filter by trend status">
        ${filters
          .map((k) => `<button class="filter" type="button" data-filter="${k}" aria-pressed="${k === "all"}">${k === "all" ? "All" : esc(statusInfo(k).label)}<span class="filter__count">${counts[k]}</span></button>`)
          .join("")}
      </div>
    </header>
    <div class="az" id="az"></div>`;

  const draw = (filter) => {
    const items = state.catalog
      .filter((a) => filter === "all" || state.summaryBySlug.get(a.slug)?.status === filter)
      .sort((x, y) => x.name.localeCompare(y.name));
    const groups = new Map();
    for (const a of items) {
      const letter = /[a-z]/i.test(a.name[0]) ? a.name[0].toUpperCase() : "#";
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(a);
    }
    document.getElementById("az").innerHTML = [...groups]
      .map(([letter, list]) => `
        <section class="az__group" aria-label="${letter}">
          <p class="az__letter" aria-hidden="true">${letter}</p>
          <ul class="az__list">${list
            .map((a) => {
              const s = state.summaryBySlug.get(a.slug);
              return `<li><a href="#/t/${esc(a.slug)}">${esc(a.name)}</a><span class="az__status">${esc(s ? statusInfo(s.status).label : "No trend data")}</span></li>`;
            })
            .join("")}</ul>
        </section>`)
      .join("");
  };

  app.querySelectorAll(".filter").forEach((btn) =>
    btn.addEventListener("click", () => {
      app.querySelectorAll(".filter").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      draw(btn.dataset.filter);
    })
  );
  draw("all");
}

function renderAbout() {
  setPage("about", "About");
  const tested = state.summary.filter((s) => s.backtest_skill != null);
  const beat = tested.filter((s) => s.backtest_skill > 0).length;
  const wiki = state.summary.filter((s) => s.source === "wikipedia").length;
  const google = state.summary.filter((s) => s.source === "google_trends").length;

  app.innerHTML = `
    <header class="page-head">
      <h1 class="page-title">About</h1>
      <p class="page-dek">How the trends are measured, how the forecasts work, and where they fall short.</p>
    </header>
    <div class="container-text prose">
      <h2>What it tracks</h2>
      <p>${state.catalog.length} fashion aesthetics, from long-running subcultures like goth and punk to micro-trends that lived and died on TikTok. Each one has a short description, its key pieces, a color palette and related aesthetics.</p>

      <h2>How popularity is measured</h2>
      <ul>
        <li><strong>Wikipedia page views</strong> (${wiki} aesthetics): monthly visits to the aesthetic’s Wikipedia article since July 2015.</li>
        <li><strong>Google Trends</strong> (${google} aesthetics): monthly search interest for aesthetics without a dedicated article, rescaled with a shared reference term so they can be compared with each other.</li>
      </ul>
      <p>The two sources use different units, so compare the shape of each chart rather than the raw numbers across sources.</p>

      <h2>How the forecasts work</h2>
      <p>Each aesthetic gets an exponential smoothing model that learns its current level, its direction and, with enough history, its yearly rhythm. It projects 12 months ahead with a range the real value should land in about 80% of the time.</p>
      <p>To check the models honestly, the last 6 months of each history were hidden and forecast. ${tested.length ? `The model beat a simple “nothing changes” guess on ${beat} of ${tested.length} aesthetics it could be tested on.` : "Accuracy results will appear here after the forecast script runs."}</p>

      <h2>Limits</h2>
      <ul>
        <li>Page views and searches measure attention, not what people actually wear.</li>
        <li>A news story or a viral video can spike interest without the look catching on.</li>
        <li>Newer aesthetics have short histories, so their forecasts are less certain.</li>
      </ul>

      <h2>Credits</h2>
      <p>Aesthetic details come from the <a href="https://huggingface.co/datasets/ninar12/aesthetics-wiki">Aesthetics Wiki dataset</a> (MIT license), edited by hand. Popularity data comes from the Wikimedia Pageviews API and Google Trends.</p>
    </div>`;
}

function renderNotFound() {
  setPage("missing", "Not found");
  app.innerHTML = `<p class="empty">That page doesn’t exist. <a href="#/">Go back to all trends</a> or search above.</p>`;
}

/* ---------- Router ---------- */

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const page = parts[0];
  if (!page) renderHome();
  else if (page === "t" && parts[1]) renderDetail(decodeURIComponent(parts[1]));
  else if (page === "index") renderIndex();
  else if (page === "about") renderAbout();
  else renderNotFound();

  if (!firstRoute) {
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
  firstRoute = false;
}

async function init() {
  try {
    const [catalog, summary] = await Promise.all([
      getJSON("data/catalog.json"),
      getJSON("data/summary.json").catch(() => []),
    ]);
    state.catalog = catalog;
    state.bySlug = new Map(catalog.map((a) => [a.slug, a]));
    state.summary = summary;
    state.summaryBySlug = new Map(summary.map((s) => [s.slug, s]));
  } catch (err) {
    app.innerHTML = `<p class="empty">Couldn’t load the trend data (${esc(err.message)}). If you opened index.html directly, start a local server in the docs folder with “python -m http.server 8000” and visit localhost:8000.</p>`;
    return;
  }
  mountSearch(document.getElementById("header-search"), "compact");
  window.addEventListener("hashchange", route);
  route();
}

init();
