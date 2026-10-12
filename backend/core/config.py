import os
from pathlib import Path
from dotenv import load_dotenv

# backend/core/config.py -> parents[0]=core, [1]=backend, [2]=project root
ROOT_DIR      = Path(__file__).resolve().parents[2]
ANALYTICS_DIR = ROOT_DIR / "data" / "analytics"
CLEAN_DIR     = ROOT_DIR / "data" / "clean"

# Read secrets from the .env file in the project root (never hard-code keys)
load_dotenv(ROOT_DIR / ".env")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Business settings shared by the API and the bot
WHOLESALE_LOCATION = "LOC003"
FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]   # React dev server

# ----- AI assistant -----
# ----- AI assistant -----
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
# Backup models tried in order if the main one is busy (503) or rate-limited (429)
_fallbacks = os.getenv("GEMINI_FALLBACK_MODELS",
                       "gemini-3.7-flash,gemini-3.5-flash,gemini-flash-latest")
GEMINI_MODELS = [GEMINI_MODEL] + [m.strip() for m in _fallbacks.split(",")
                                  if m.strip() and m.strip() != GEMINI_MODEL]
BOT_DIR = ROOT_DIR / "data" / "bot"          # orders + demand signals written by the bot
BOT_DIR.mkdir(parents=True, exist_ok=True)