from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SQL_FILE = str(ROOT / "run_page" / "data.db")
JSON_FILE = str(ROOT / "src" / "static" / "activities.json")
