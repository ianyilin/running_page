import argparse
import datetime as dt
import gzip
import json
import os
import warnings
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

os.environ["GARTH_TELEMETRY_ENABLED"] = "false"
warnings.filterwarnings("ignore", message="Garth is deprecated", category=DeprecationWarning)

import garth
import requests

from apple_workout_import import (
    duration_string,
    is_same_run,
    load_existing,
    parse_gpx_activity,
    parse_local_datetime,
    recompute_streaks,
)
from config import GARMIN_GPX_DIR, JSON_FILE


GARMIN_DOMAINS = {
    "COM": {
        "garth_domain": "garmin.com",
        "connect_api": "https://connectapi.garmin.com",
    },
    "CN": {
        "garth_domain": "garmin.cn",
        "connect_api": "https://connectapi.garmin.cn",
    },
}
DEFAULT_TIMEZONE = "America/New_York"


def parse_garmin_time(value: Any, timezone: ZoneInfo) -> tuple[dt.datetime, dt.datetime]:
    if not value:
        now = dt.datetime.now(dt.timezone.utc)
        return now, now.astimezone(timezone).replace(tzinfo=None)

    text = str(value).strip().replace("Z", "+00:00")
    if "T" not in text and " " in text:
        text = text.replace(" ", "T", 1)

    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)

    utc = parsed.astimezone(dt.timezone.utc)
    local = utc.astimezone(timezone).replace(tzinfo=None)
    return utc, local


def first_value(data: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        value = data.get(name)
        if value not in (None, ""):
            return value
    return None


def as_float(value: Any, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def metadata_from_activity(
    activity_id: int,
    activity: dict[str, Any],
    summary: dict[str, Any] | None,
    timezone: ZoneInfo,
) -> dict[str, Any]:
    summary = summary or {}
    summary_dto = summary.get("summaryDTO") or {}
    source = {**activity, **summary, **summary_dto}

    start_raw = first_value(source, ("startTimeGMT", "startTimeGmt", "start_time"))
    start_utc, start_local = parse_garmin_time(start_raw, timezone)

    local_raw = first_value(source, ("startTimeLocal", "startTimeLocalDisplay"))
    if local_raw:
        try:
            local_text = str(local_raw).replace(" ", "T", 1)
            start_local = dt.datetime.fromisoformat(local_text).replace(tzinfo=None)
        except ValueError:
            pass

    moving_seconds = as_float(
        first_value(source, ("movingDuration", "duration", "elapsedDuration")), 1.0
    )
    distance = as_float(first_value(source, ("distance", "sumDistance")))

    return {
        "run_id": activity_id,
        "name": first_value(source, ("activityName", "activity_name", "name")) or "Garmin Run",
        "distance": round(distance, 1),
        "moving_time": duration_string(moving_seconds),
        "type": "Run",
        "subtype": "Run",
        "start_date": start_utc.strftime("%Y-%m-%d %H:%M:%S+00:00"),
        "start_date_local": start_local.strftime("%Y-%m-%d %H:%M:%S"),
        "location_country": "",
        "summary_polyline": "",
        "average_heartrate": first_value(
            source, ("averageHR", "averageHr", "average_heartrate")
        ),
        "average_speed": round(distance / moving_seconds, 3) if moving_seconds else 0,
        "elevation_gain": round(
            as_float(
                first_value(
                    source,
                    (
                        "elevationGain",
                        "elevation_gain",
                        "totalElevationGain",
                        "total_elevation_gain",
                    ),
                )
            ),
            1,
        ),
    }


class GarminConnectClient:
    def __init__(self, secret_string: str, domain: str):
        domain_key = domain.upper()
        if domain_key not in GARMIN_DOMAINS:
            raise ValueError(f"Unsupported Garmin domain: {domain}")

        config = GARMIN_DOMAINS[domain_key]
        garth.configure(domain=config["garth_domain"], ssl_verify=domain_key != "CN")
        garth.client.loads(secret_string)
        if garth.client.oauth2_token.expired:
            garth.client.refresh_oauth2()

        self.base_url = config["connect_api"]
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": str(garth.client.oauth2_token),
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
            }
        )

    def get_activities(self, start: int, limit: int, only_run: bool) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"start": start, "limit": limit}
        if only_run:
            params["activityType"] = "running"
        response = self.session.get(
            f"{self.base_url}/activitylist-service/activities/search/activities",
            params=params,
            timeout=120,
        )
        response.raise_for_status()
        return response.json()

    def get_activity_summary(self, activity_id: int) -> dict[str, Any] | None:
        response = self.session.get(
            f"{self.base_url}/activity-service/activity/{activity_id}",
            timeout=120,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def download_gpx(self, activity_id: int) -> bytes | None:
        response = self.session.get(
            f"{self.base_url}/download-service/export/gpx/activity/{activity_id}",
            timeout=180,
        )
        if response.status_code in {204, 404}:
            return None
        response.raise_for_status()
        content = response.content
        if content[:2] == bytes([0x1F, 0x8B]):
            content = gzip.decompress(content)
        return content


def fetch_all_activities(
    client: GarminConnectClient,
    only_run: bool,
    page_size: int,
    max_pages: int | None,
) -> list[dict[str, Any]]:
    activities: list[dict[str, Any]] = []
    start = 0
    page = 0
    while max_pages is None or page < max_pages:
        page_items = client.get_activities(start=start, limit=page_size, only_run=only_run)
        if not page_items:
            break
        activities.extend(page_items)
        if len(page_items) < page_size:
            break
        start += page_size
        page += 1
    return activities


def activity_id(activity: dict[str, Any]) -> int | None:
    raw_id = activity.get("activityId") or activity.get("activity_id") or activity.get("id")
    if raw_id in (None, ""):
        return None
    try:
        return int(raw_id)
    except (TypeError, ValueError):
        return None


def merge_activity(activities: list[dict[str, Any]], candidate: dict[str, Any]) -> bool:
    for index, existing in enumerate(activities):
        if existing.get("run_id") == candidate["run_id"]:
            merged = {
                **existing,
                **candidate,
                "location_country": existing.get("location_country")
                or candidate.get("location_country")
                or "",
                "summary_polyline": candidate.get("summary_polyline")
                or existing.get("summary_polyline")
                or "",
            }
            if merged != existing:
                activities[index] = merged
                return True
            return False
        if is_same_run(existing, candidate):
            merged = {
                **existing,
                **candidate,
                "location_country": existing.get("location_country")
                or candidate.get("location_country")
                or "",
                "summary_polyline": candidate.get("summary_polyline")
                or existing.get("summary_polyline")
                or "",
            }
            if merged != existing:
                activities[index] = merged
                return True
            return False
    activities.append(candidate)
    return True


def build_candidate(
    activity_id_value: int,
    activity: dict[str, Any],
    summary: dict[str, Any] | None,
    gpx_path: Path | None,
    timezone: ZoneInfo,
) -> dict[str, Any]:
    metadata = metadata_from_activity(activity_id_value, activity, summary, timezone)
    parsed = parse_gpx_activity(gpx_path, timezone) if gpx_path else None
    if not parsed:
        return metadata

    return {
        **parsed,
        **metadata,
        "summary_polyline": parsed.get("summary_polyline") or metadata["summary_polyline"],
        "elevation_gain": metadata.get("elevation_gain") or parsed.get("elevation_gain") or 0,
    }


def sync_garmin(
    secret_string: str,
    output_file: Path,
    gpx_dir: Path,
    timezone_name: str,
    only_run: bool,
    domain: str,
    dry_run: bool,
    max_pages: int | None,
) -> tuple[int, int, int]:
    timezone = ZoneInfo(timezone_name)
    client = GarminConnectClient(secret_string, domain)
    source_activities = fetch_all_activities(
        client=client,
        only_run=only_run,
        page_size=100,
        max_pages=max_pages,
    )
    activities = load_existing(output_file)
    gpx_dir.mkdir(parents=True, exist_ok=True)

    imported = 0
    skipped = 0
    downloaded = 0

    for activity in source_activities:
        activity_id_value = activity_id(activity)
        if activity_id_value is None:
            skipped += 1
            continue

        summary = None
        try:
            summary = client.get_activity_summary(activity_id_value)
        except Exception as exc:
            print(f"Warning: failed to fetch Garmin summary {activity_id_value}: {exc}")

        gpx_path = gpx_dir / f"{activity_id_value}.gpx"
        if not gpx_path.exists():
            try:
                content = client.download_gpx(activity_id_value)
            except Exception as exc:
                print(f"Warning: failed to download Garmin GPX {activity_id_value}: {exc}")
                content = None
            if content:
                if not dry_run:
                    gpx_path.write_bytes(content)
                downloaded += 1
            else:
                gpx_path = None

        candidate = build_candidate(
            activity_id_value=activity_id_value,
            activity=activity,
            summary=summary,
            gpx_path=gpx_path if gpx_path and gpx_path.exists() else None,
            timezone=timezone,
        )
        if merge_activity(activities, candidate):
            imported += 1
        else:
            skipped += 1

    activities.sort(key=parse_local_datetime)
    recompute_streaks(activities)

    if not dry_run:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(
            json.dumps(activities, ensure_ascii=False),
            encoding="utf-8",
        )

    return imported, skipped, downloaded


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync running activities from Garmin Connect.")
    parser.add_argument(
        "secret_string",
        nargs="?",
        default=os.environ.get("GARMIN_SECRET_STRING"),
        help="secret string from get_garmin_secret.py",
    )
    parser.add_argument("--output", default=JSON_FILE)
    parser.add_argument("--gpx-dir", default=GARMIN_GPX_DIR)
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--only-run", action="store_true")
    parser.add_argument("--is-cn", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-pages", type=int, default=None)
    args = parser.parse_args()

    if not args.secret_string:
        raise SystemExit("Missing GARMIN_SECRET_STRING")

    imported, skipped, downloaded = sync_garmin(
        secret_string=args.secret_string,
        output_file=Path(args.output),
        gpx_dir=Path(args.gpx_dir),
        timezone_name=args.timezone,
        only_run=args.only_run,
        domain="CN" if args.is_cn else "COM",
        dry_run=args.dry_run,
        max_pages=args.max_pages,
    )
    action = "Would import" if args.dry_run else "Imported"
    print(
        f"{action} {imported} Garmin run(s); skipped {skipped}; "
        f"downloaded {downloaded} GPX file(s)."
    )


if __name__ == "__main__":
    main()
