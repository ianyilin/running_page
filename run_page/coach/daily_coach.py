import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path


COACH_DIR = Path(__file__).resolve().parent
RUN_PAGE_DIR = COACH_DIR.parent
ROOT = RUN_PAGE_DIR.parent
OUTPUT_DIR = RUN_PAGE_DIR / "coach_output"
PLAN_FILE = OUTPUT_DIR / "latest_plan.json"

sys.path.insert(0, str(RUN_PAGE_DIR))

from coach.azure_plan import generate_plan  # noqa: E402
from coach.build_context import build_context  # noqa: E402
from coach.email_plan import send_plan_email  # noqa: E402


ENV_FILE = ROOT / ".env"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def write_plan(plan: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PLAN_FILE.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="generate a rule-based plan without calling Azure OpenAI",
    )
    parser.add_argument(
        "--send-email",
        action="store_true",
        help="send the generated plan by SMTP",
    )
    parser.add_argument(
        "--target-date",
        help="target training date in YYYY-MM-DD; defaults to today in America/New_York",
    )
    args = parser.parse_args()

    load_env_file(ENV_FILE)
    target_date = (
        dt.date.fromisoformat(args.target_date) if args.target_date else None
    )
    context = build_context(target_date=target_date)
    plan = generate_plan(context, dry_run=args.dry_run)
    write_plan(plan)

    if args.send_email:
        send_plan_email(plan, context)

    print(f"Wrote {PLAN_FILE.relative_to(ROOT)}")
    print(plan.get("email_subject") or plan.get("workout_type"))


if __name__ == "__main__":
    main()
