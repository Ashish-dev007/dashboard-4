# 📈 STIR Pro Dashboard

A professional dark-mode analytics dashboard for US short-term interest rate instruments — **SR1**, **ZQ** (30-Day Fed Funds Futures), and **SR3** (3-Month SOFR Futures).

## Features

| Tab | What you see |
|-----|-------------|
| **Master View** | SR3 3-Month Spread Curve + ZQ Implied EFFR, side-by-side |
| **Meeting Premiums** | Per-FOMC-meeting premium curve with reference-date overlay |
| **SR3 Curve** | Full quarterly outright curve + 3M spread chart + mapping table |
| **ZQ / EFFR** | ZQ price and implied EFFR derived from meeting premiums |
| **Neutral Rate & Cuts/Hikes** | Rolling neutral rate + annual cut/hike bar chart + DoD table |
| **Meeting Differences** | Q→Q (SEP) and nQ→nQ premium spread differences |
| **Events Calendar** | Macro releases, FOMC decisions, Fed speakers with stance tags |

**Controls**
- Date slider (day or week step)
- ◀ / ▶ Prev/Next FOMC jump buttons
- Keyboard arrow keys (left/right = day, up/down = week)
- Reference-date overlay for delta analysis

---

## Repo Structure

```
├── app.py                # Streamlit entry point
├── requirements.txt      # Python dependencies
├── index.html            # Dashboard HTML scaffold
├── style.css             # Dark-mode glassmorphism CSS
├── app.js                # Chart rendering + financial logic
├── data.js               # Pre-processed market data (SR3, Meeting Premiums, Events)
├── chart_umd_min.js      # Chart.js v4 (local copy — optional, CDN fallback built in)
└── .streamlit/
    └── config.toml       # Streamlit theme + server settings
```

---

## Running Locally

```bash
# 1. Clone
git clone https://github.com/<your-username>/stir-dashboard.git
cd stir-dashboard

# 2. Install
pip install -r requirements.txt

# 3. Run
streamlit run app.py
```

The dashboard opens at **http://localhost:8501**

---

## Deploying to Streamlit Cloud

1. Push this repo to GitHub (public or private).
2. Go to **[share.streamlit.io](https://share.streamlit.io)** → **New app**.
3. Select your repo, branch `main`, and set **Main file path** to `app.py`.
4. Click **Deploy** — that's it.

> **Note on file sizes**  
> `data.js` (~530 KB) and `chart_umd_min.js` (~200 KB) are inlined into the page on first load and then **cached** by `@st.cache_resource`, so subsequent visits are instant.  
> If you want to reduce repo size you can delete `chart_umd_min.js`; `app.py` will automatically fall back to the jsDelivr CDN.

---

## Data Coverage

| Dataset | Range |
|---------|-------|
| Meeting Premiums (ZQ/SR1) | Jan 2021 → Apr 2025 |
| SR3 Outright Prices | Jan 2025 → Sep 2025 |
| FOMC Calendar | 2025 → 2027 |
| Events / Fed Speakers | Jan 2025 → Apr 2025 |

---

## How `app.py` Works

```
index.html (structure)
    + style.css  →  inlined <style>
    + chart_umd_min.js  →  inlined <script>
    + data.js    →  inlined <script>
    + app.js     →  inlined <script>
              ↓
   Single self-contained HTML string
              ↓
   st.components.v1.html(html, height=940, scrolling=True)
```

No Python charting libraries are used; all rendering is done by Chart.js inside the iframe.

---

## Instruments Explained

| Symbol | Full Name | Pricing |
|--------|-----------|---------|
| **SR1** | 1-Month SOFR Futures | `100 − monthly avg SOFR` |
| **SR3** | 3-Month SOFR Futures | `100 − compounded 3M SOFR` |
| **ZQ** | 30-Day Fed Funds Futures | `100 − monthly avg EFFR` |

**Meeting Premium** = the market-implied rate change priced into each FOMC meeting, read from SR1/ZQ contracts that span that meeting date.

**Neutral Rate** = `100 − max(SR3 outright price across the full curve)` — the long-run rate the market expects rates to settle at.
