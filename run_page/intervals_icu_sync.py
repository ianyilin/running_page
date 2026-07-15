import argparse
import datetime as dt
import gzip
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from requests.auth import HTTPBasicAuth

from apple_workout_import import (
    duration_string,
    haversine_m,
    is_same_run,
    load_existing,
    parse_gpx_activity,
    parse_local_datetime,
    recompute_streaks,
)
from config import JSON_FILE
from polyline_processor import filter_out

import polyline


BASE_URL = "https://intervals.icu/api/v1"
RUNNING_TYPES = {"Run", "VirtualRun", "TrailRun"}
DEFAULT_TIMEZONE = "America/New_York"


class IntervalsClient:
    def __init__(self, athlete_id: str, api_key: str):
        self.athlete_id = athlete_id
        self.session = requests.Session()
        self.session.auth = HTTPBasicAuth("API_KEY", api_key)
        self.session.headers.update({"Accept": "application/json"})

    def get_activities(self, oldest: str, newest: str) -> list[dict[str, Any]]:
        response = self.session.get(
            f"{BASE_URL}/athlete/{self.athlete_id}/activities",
            params={"oldest": oldest, "newest": newest},
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def download_activity_file(
        self, activity_id: str, output_dir: Path, file_type_hint: str | None
    ) -> Path | None:
        response = self.session.get(
            f"{BASE_URL}/activity/{activity_id}/file",
            timeout=90,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()

        content = response.content
        if content[:2] == bytes([0x1F, 0x8B]):
            content = gzip.decompress(content)

        suffix = file_suffix(response, activity_id, file_type_hint)
        path = output_dir / f"{safe_id(activity_id)}.{suffix}"
        path.write_bytes(content)
        return path


def file_suffix(
    response: requests.Response, activity_id: str, file_type_hint: str | None
) -> str:
    if file_type_hint:
        return file_type_hint.lower()

    disposition = response.headers.get("content-disposition", "")
    for suffix in ("gpx", "fit", "tcx"):
        if f".{suffix}" in disposition.lower():
            return suffix

    content_type = response.headers.get("content-type", "").lower()
    if "gpx" in content_type or "xml" in content_type:
        return "gpx"
    if "fit" in content_type or "octet-stream" in content_type:
        return "fit"
    return str(activity_id).rsplit(".", 1)[-1].lower() if "." in str(activity_id) else "fit"


def safe_id(value: Any) -> str:
    return "".join(ch for ch in str(value) if ch.isalnum() or ch in {"-", "_"}) or "activity"


def stable_run_id(activity: dict[str, Any]) -> int:
    raw_id = str(activity.get("id", ""))
    digits = "".join(ch for ch in raw_id if ch.isdigit())
    if digits:
        return int(digits)
    digest = hashlib.sha1(raw_id.encode("utf-8")).hexdigest()
    return 9_000_000_000_000 + int(digest[:10], 16)


def first_value(activity: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        value = activity.get(name)
        if value not in (None, ""):
            return value
    return None


def distance_meters(activity: dict[str, Any]) -> float:
    value = first_value(activity, ("distance_m", "distance"))
    if value is None:
        return 0.0
    distance = float(value)
    if "distance_m" not in activity and distance < 1000:
        return distance * 1000
    return distance


def seconds_from_value(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value)
    if text.isdigit():
        return float(text)
    parts = text.split(":")
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    if len(parts) == 2:
        minutes, seconds = parts
        return int(minutes) * 60 + float(seconds)
    return 0.0


def parse_interval_time(value: Any, timezone: ZoneInfo) -> tuple[dt.datetime, dt.datetime]:
    local_raw = first_value(
        value,
        ("start_date_local", "start_time_local", "start_date", "start_time"),
    )
    if not local_raw:
        now = dt.datetime.now(timezone)
        return now.astimezone(dt.timezone.utc), now.replace(tzinfo=None)

    text = str(local_raw).replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        local = parsed
        utc = local.replace(tzinfo=timezone).astimezone(dt.timezone.utc)
    else:
        utc = parsed.astimezone(dt.timezone.utc)
        local = utc.astimezone(timezone).replace(tzinfo=None)
    return utc, local


def metadata_duration_seconds(activity: dict[str, Any], timezone: ZoneInfo) -> float:
    moving_seconds = seconds_from_value(
        first_value(activity, ("moving_time", "elapsed_time", "duration"))
    )
    if moving_seconds <= 0 and activity.get("end_date_local"):
        _, start_local = parse_interval_time(activity, timezone)
        end_local = dt.datetime.fromisoformat(str(activity["end_date_local"]))
        moving_seconds = max(1.0, (end_local - start_local).total_seconds())
    return max(1.0, moving_seconds)


def activity_from_metadata(activity: dict[str, Any], timezone: ZoneInfo) -> dict[str, Any]:
    distance = distance_meters(activity)
    moving_seconds = metadata_duration_seconds(activity, timezone)
    start_utc, start_local = parse_interval_time(activity, timezone)

    return {
        "run_id": stable_run_id(activity),
        "name": activity.get("name") or "Intervals.icu Run",
        "distance": round(distance, 1),
        "moving_time": str(dt.timedelta(seconds=int(round(moving_seconds)))),
        "type": "Run",
        "subtype": activity.get("type") or "Run",
        "start_date": start_utc.strftime("%Y-%m-%d %H:%M:%S+00:00"),
        "start_date_local": start_local.strftime("%Y-%m-%d %H:%M:%S"),
        "location_country": "",
        "summary_polyline": "",
        "average_heartrate": first_value(
            activity, ("average_heartrate", "avg_hr", "average_hr")
        ),
        "average_speed": round(distance / moving_seconds, 3),
        "elevation_gain": first_value(
            activity, ("total_elevation_gain", "elevation_gain", "elev_gain")
        )
        or 0,
    }


def normalize_timestamp(value: Any, timezone: ZoneInfo) -> dt.datetime | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        parsed = value
    else:
        text = str(value).replace("Z", "+00:00")
        try:
            parsed = dt.datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone)
    return parsed.astimezone(dt.timezone.utc)


def parse_fit_activity(
    path: Path, metadata: dict[str, Any], timezone: ZoneInfo
) -> dict[str, Any] | None:
    try:
        from fit_tool.fit_file import FitFile
        from fit_tool.profile.messages.record_message import RecordMessage
    except Exception as exc:
        print(f"Warning: fit-tool is unavailable, using Intervals metadata: {exc}")
        return None

    fit = FitFile.from_file(str(path))
    coords: list[tuple[float, float]] = []
    timestamps: list[dt.datetime] = []
    heart_rates: list[float] = []
    elevations: list[float] = []
    record_distances: list[float] = []

    for record in fit.records:
        msg = record.message
        if not isinstance(msg, RecordMessage):
            continue

        timestamp = normalize_timestamp(getattr(msg, "timestamp", None), timezone)
        if timestamp:
            timestamps.append(timestamp)

        lat = getattr(msg, "position_lat", None)
        lon = getattr(msg, "position_long", None)
        if lat is not None and lon is not None:
            coords.append((float(lat), float(lon)))

        heart_rate = getattr(msg, "heart_rate", None)
        if heart_rate is not None:
            heart_rates.append(float(heart_rate))

        altitude = getattr(msg, "enhanced_altitude", None) or getattr(
            msg, "altitude", None
        )
        if altitude is not None:
            elevations.append(float(altitude))

        distance = getattr(msg, "distance", None)
        if distance is not None:
            record_distances.append(float(distance))

    if not timestamps and not coords:
        return None

    if record_distances:
        distance = max(record_distances)
    else:
        distance = sum(haversine_m(prev, curr) for prev, curr in zip(coords, coords[1:]))

    # Intervals metadata is the authority for workout date and duration.
    # FIT files from Apple/Health integrations can contain nonstandard epoch
    # values that fit-tool may decode as impossible dates.
    start_utc, start_local = parse_interval_time(metadata, timezone)
    moving_seconds = metadata_duration_seconds(metadata, timezone)

    elevation_gain = 0.0
    for prev, curr in zip(elevations, elevations[1:]):
        delta = curr - prev
        if delta > 0:
            elevation_gain += delta

    encoded = filter_out(polyline.encode(coords)) if len(coords) >= 2 else ""
    average_hr = (
        round(sum(heart_rates) / len(heart_rates), 1) if heart_rates else None
    )

    return {
        "run_id": stable_run_id(metadata),
        "name": metadata.get("name") or "Intervals.icu Run",
        "distance": round(distance, 1),
        "moving_time": duration_string(moving_seconds),
        "type": "Run",
        "subtype": metadata.get("type") or "Run",
        "start_date": start_utc.strftime("%Y-%m-%d %H:%M:%S+00:00"),
        "start_date_local": start_local.strftime("%Y-%m-%d %H:%M:%S"),
        "location_country": "",
        "summary_polyline": encoded or "",
        "average_heartrate": average_hr,
        "average_speed": round(distance / moving_seconds, 3),
        "elevation_gain": round(elevation_gain, 1),
    }


def merge_activity(activities: list[dict[str, Any]], candidate: dict[str, Any]) -> bool:
    for index, existing in enumerate(activities):
        if existing.get("run_id") == candidate["run_id"]:
            merged = {
                **existing,
                **candidate,
                "location_country": existing.get("location_country")
                or candidate.get("location_country")
                or "",
            }
            if merged != existing:
                activities[index] = merged
                return True
            return False
        if is_same_run(existing, candidate):
            if candidate.get("summary_polyline") and not existing.get("summary_polyline"):
                activities[index] = {**existing, **candidate}
                return True
            return False
    activities.append(candidate)
    return True


def sync_intervals(
    athlete_id: str,
    api_key: str,
    output_file: Path,
    start_date: str,
    timezone_name: str,
    dry_run: bool,
) -> tuple[int, int]:
    timezone = ZoneInfo(timezone_name)
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    client = IntervalsClient(athlete_id, api_key)
    source_activities = client.get_activities(oldest=start_date, newest=today)
    source_activities = [
        activity
        for activity in source_activities
        if activity.get("type") in RUNNING_TYPES
        and activity.get("source") != "STRAVA"
        and activity.get("_note") is None
    ]

    activities = load_existing(output_file)
    imported = 0
    skipped = 0

    with tempfile.TemporaryDirectory(prefix="intervals-icu-") as tmp:
        tmp_dir = Path(tmp)
        gpx_dir = tmp_dir / "gpx"
        gpx_dir.mkdir()

        for activity in source_activities:
            candidate = None
            activity_id = str(activity.get("id", ""))
            try:
                file_type_hint = (
                    str(activity.get("file_type")).lower()
                    if activity.get("file_type")
                    else None
                )
                file_path = client.download_activity_file(
                    activity_id, tmp_dir, file_type_hint
                )
            except Exception as exc:
                print(f"Warning: failed to download {activity_id}: {exc}")
                file_path = None

            if file_path and file_path.suffix.lower() == ".gpx":
                gpx_copy = gpx_dir / file_path.name
                gpx_copy.write_bytes(file_path.read_bytes())
                candidate = parse_gpx_activity(gpx_copy, timezone)
                if candidate:
                    candidate["run_id"] = stable_run_id(activity)
                    candidate["name"] = activity.get("name") or candidate["name"]
            elif file_path and file_path.suffix.lower() == ".fit":
                candidate = parse_fit_activity(file_path, activity, timezone)

            if candidate is None:
                candidate = activity_from_metadata(activity, timezone)

            if merge_activity(activities, candidate):
                imported += 1
            else:
                skipped += 1

        # Importing the GPX directory computes any GPX-only activities not covered above.
        # The explicit merge above is kept so FIT-only activities still update the log.
        activities.sort(key=parse_local_datetime)
        recompute_streaks(activities)

        if not dry_run:
            output_file.parent.mkdir(parents=True, exist_ok=True)
            with output_file.open("w", encoding="utf-8") as f:
                json.dump(activities, f, ensure_ascii=False)

    return imported, skipped


def required(value: str | None, name: str) -> str:
    if not value:
        raise SystemExit(f"Missing {name}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync running activities from Intervals.icu.")
    parser.add_argument("athlete_id", nargs="?")
    parser.add_argument("api_key", nargs="?")
    parser.add_argument("--output", default=JSON_FILE)
    parser.add_argument("--start-date", default="2015-01-01")
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    athlete_id = required(args.athlete_id, "INTERVALS_ICU_ATHLETE_ID")
    api_key = required(args.api_key, "INTERVALS_ICU_API_KEY")
    imported, skipped = sync_intervals(
        athlete_id=athlete_id,
        api_key=api_key,
        output_file=Path(args.output),
        start_date=args.start_date,
        timezone_name=args.timezone,
        dry_run=args.dry_run,
    )
    action = "Would import" if args.dry_run else "Imported"
    print(f"{action} {imported} Intervals.icu run(s); skipped {skipped}.")


if __name__ == "__main__":
    main()
