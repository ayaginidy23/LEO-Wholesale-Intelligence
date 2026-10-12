"""List the Gemini models available to THIS API key (run once, then delete)."""
from google import genai
from core.config import GEMINI_API_KEY

client = genai.Client(api_key=GEMINI_API_KEY)
for m in client.models.list():
    actions = getattr(m, "supported_actions", None) or []
    if "flash" in m.name and "generateContent" in actions:
        print(m.name)