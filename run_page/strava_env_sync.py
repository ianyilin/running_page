import os
import sys
from pathlib import Path

from requests.exceptions import RequestException
from stravalib.exc import AccessUnauthorized

from strava_sync import run_strava_sync


ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"Missing {name}. Add it to .env or export it before running.", file=sys.stderr)
        sys.exit(1)
    return value


def env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def main() -> None:
    load_env_file(ENV_FILE)

    try:
        run_strava_sync(
            required_env("STRAVA_CLIENT_ID"),
            required_env("STRAVA_CLIENT_SECRET"),
            required_env("STRAVA_CLIENT_REFRESH_TOKEN"),
            only_run=env_flag("STRAVA_ONLY_RUN", default=True),
        )
    except AccessUnauthorized as exc:
        sys.stdout.flush()
        print("Strava authorization failed.", file=sys.stderr)
        print(
            "Your refresh token is valid, but it does not include activity read permission.",
            file=sys.stderr,
        )
        print(
            "Re-authorize Strava with scope=read_all,profile:read_all,activity:read_all, then update STRAVA_CLIENT_REFRESH_TOKEN in .env.",
            file=sys.stderr,
        )
        print(f"Strava error: {exc}", file=sys.stderr)
        sys.exit(1)
    except RequestException as exc:
        sys.stdout.flush()
        print("Could not connect to Strava.", file=sys.stderr)
        print(
            "Check your network connection, then rerun pnpm data:download:strava.",
            file=sys.stderr,
        )
        print(f"Network error: {exc.__class__.__name__}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
