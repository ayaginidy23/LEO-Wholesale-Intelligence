# LEO Wholesale Intelligence

A decision tool built for **El-Sharnouby Group (LEO MODA)**, a kids' and women's pajama and homewear manufacturer in Alexandria. It was built for the HVIA Task 02 challenge.

Wholesale traders bring ~85% of revenue, yet the wholesale desk ran on phone calls and guesswork. This app gives the team one place to see who to call, what stock to move, and what to produce. It also gives traders a 24/7 assistant that answers from live company data.

## What's inside

| Page | Used by | What it does |
|---|---|---|
| **Overview** | Owner / management | Headline KPIs, monthly sales by channel, key findings |
| **Traders** | Wholesale sales team | RFM segments, overdue traders, next action per trader, hidden wholesale buyers |
| **Stock & Forecast** | Warehouse / production | Stock health per location, store-to-desk transfer suggestions, 30/60/90-day forecast, production plan |
| **Wholesale Chat** | Traders (WhatsApp in production) | Gemini assistant with function calling: product search, stock per size, tiered price, clearance offers, order creation |

## Key findings

- **Wholesale is the business.** ~5.5% of customers bring ~85% of revenue and ~66% of profit.
- **The margin leak is the discount.** The wholesale margin is ~12% vs 35–37% in retail, because of a flat ~33% trader discount. Each discount point is worth ≈ 5.3M EGP of profit.
- **Revenue at risk.** 371 previously active traders hold ~34% of wholesale revenue.
- **Stock in the wrong place.** The Wholesale Desk is short on 49 of 59 products while stores are overstocked. Rebalance before producing.
- **Honest limits.** A churn model was tested and rejected (AUC ≈ 0.5), so "at risk" is descriptive, not predictive. CSAT does not change with wait time, so the bot's value is workload and 24/7 availability, not satisfaction.

## Tech stack

- **Data:** Python, pandas, NumPy, scikit-learn, Parquet (Jupyter notebooks for cleaning and analysis)
- **Backend:** FastAPI, Uvicorn, Google Gemini (`google-genai`) with automatic function calling and model fallback
- **Frontend:** React (Vite), Tailwind CSS v4, Recharts, React Router, react-markdown

## Project structure

```
backend/
  main.py            # FastAPI endpoints
  core/config.py     # paths, env, model settings
  core/loader.py     # loads analytics files once (cached)
  core/bot.py        # Gemini chat sessions + retry/fallback
  core/bot_tools.py  # functions the bot can call
frontend/
  src/pages/         # Overview, Traders, Stock, Chat
notebooks/
  01_clean_reference_files.ipynb
  02_clean_sales.ipynb
  03_analysis.ipynb
```

## Run locally

> Company data is private and **not included** in this repository. The notebooks expect the raw files in `data/raw/`.

```bash
# 1) Python environment
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# 2) Run notebooks 01 → 02 → 03 to build data/clean and data/analytics

# 3) Add a .env file in the project root
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.8-flash

# 4) Backend (terminal 1)
cd backend
uvicorn main:app --reload

# 5) Frontend (terminal 2)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Acknowledgements

Thanks to **HVIA** for the challenge.
