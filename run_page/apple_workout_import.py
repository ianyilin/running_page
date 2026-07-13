import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
from zoneinfo import ZoneInfo
from xml.etree import ElementTree

import polyline

from config import JSON_FILE
from polyline_processor import filter_out


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_DIR = ROOT / "apple_workouts"
DEFAULT_TIMEZONE = "America/New_York"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(element, name: str) -> str | None:
    for child in element:
        if local_name(child.tag) == name and child.text:
            return child.text.strip()
    return None


def parse_time(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    value = value.strip()
    if value.endswith("Z"):
        value = f"{value[:-1]}+00:00"
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    radius = 6_371_000
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def duration_string(seconds: float) -> str:
    return str(dt.timedelta(seconds=max(0, int(round(seconds)))))


def read_gpx_points(path: Path) -> list[dict]:
    root = ElementTree.parse(path).getroot()
    points = []
    for element in root.iter():
        if local_name(element.tag) != "trkpt":
            continue
        lat = element.attrib.get("lat")
        lon = element.attrib.get("lon")
        if lat is None or lon is None:
            continue
        points.append(
            {
                "lat": float(lat),
                "lon": float(lon),
                "ele": float(child_text(element, "ele") or 0),
                "time": parse_time(child_text(element, "time")),
            }
        )
    return points


def read_gpx_name(path: Path) -> str | None:
    root = ElementTree.parse(path).getroot()
    for element in root.iter():
        if local_name(element.tag) == "name" and element.text:
            name = element.text.strip()
            if name:
                return name
    return None


def build_run_id(path: Path, start_time: dt.datetime | None) -> int:
    seed = f"{path.name}:{start_time.isoformat() if start_time else path.stat().st_mtime}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()
    return 8_000_000_000_000 + int(digest[:10], 16)


def parse_gpx_activity(path: Path, timezone: ZoneInfo) -> dict | None:
    points = read_gpx_points(path)
    if len(points) < 2:
        return None

    distance = 0.0
    elevation_gain = 0.0
    coords = []
    for point in points:
        coords.append((point["lat"], point["lon"]))

    for prev, curr in zip(points, points[1:]):
        distance += haversine_m((prev["lat"], prev["lon"]), (curr["lat"], curr["lon"]))
        elevation_delta = curr["ele"] - prev["ele"]
        if elevation_delta > 0:
            elevation_gain += elevation_delta

    times = [point["time"] for point in points if point["time"] is not None]
    start_utc = times[0] if times else dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc)
    end_utc = times[-1] if times else start_utc
    elapsed_seconds = max(1.0, (end_utc - start_utc).total_seconds())
    average_speed = distance / elapsed_seconds

    start_local = start_utc.astimezone(timezone).replace(tzinfo=None)
    encoded = filter_out(polyline.encode(coords)) or ""

    return {
        "run_id": build_run_id(path, start_utc),
        "name": read_gpx_name(path) or "Apple Watch Run",
        "distance": round(distance, 1),
        "moving_time": duration_string(elapsed_seconds),
        "type": "Run",
        "subtype": "Run",
        "start_date": start_utc.astimezone(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00:00"),
        "start_date_local": start_local.strftime("%Y-%m-%d %H:%M:%S"),
        "location_country": "",
        "summary_polyline": encoded,
        "average_heartrate": None,
        "average_speed": round(average_speed, 3),
        "elevation_gain": round(elevation_gain, 1),
    }


def parse_local_datetime(activity: dict) -> dt.datetime:
    return dt.datetime.strptime(activity["start_date_local"], "%Y-%m-%d %H:%M:%S")


def is_same_run(existing: dict, candidate: dict) -> bool:
    if existing.get("type") != "Run":
        return False
    try:
        existing_time = parse_local_datetime(existing)
        candidate_time = parse_local_datetime(candidate)
    except Exception:
        return False

    time_delta = abs((existing_time - candidate_time).total_seconds())
    if time_delta > 10 * 60:
        return False

    existing_distance = float(existing.get("distance") or 0)
    candidate_distance = float(candidate.get("distance") or 0)
    distance_delta = abs(existing_distance - candidate_distance)
    return distance_delta <= max(100, candidate_distance * 0.05)


def recompute_streaks(activities: list[dict]) -> None:
    streak = 0
    last_date = None
    for activity in activities:
        if activity.get("type") != "Run":
            activity.pop("streak", None)
            continue
        current_date = parse_local_datetime(activity).date()
        if last_date is None:
            streak = 1
        elif current_date == last_date:
            pass
        elif current_date == last_date + dt.timedelta(days=1):
            streak += 1
        else:
            streak = 1
        activity["streak"] = streak
        last_date = current_date


def load_existing(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def import_apple_workouts(source_dir: Path, output_file: Path, timezone_name: str, dry_run: bool) -> tuple[int, int]:
    timezone = ZoneInfo(timezone_name)
    activities = load_existing(output_file)
    imported = 0
    skipped = 0

    for gpx_file in sorted(source_dir.rglob("*.gpx")):
        activity = parse_gpx_activity(gpx_file, timezone)
        if activity is None:
            skipped += 1
            continue

        existing_index = next(
            (
                index
                for index, existing in enumerate(activities)
                if existing.get("run_id") == activity["run_id"] or is_same_run(existing, activity)
            ),
            None,
        )
        if existing_index is None:
            activities.append(activity)
            imported += 1
        else:
            skipped += 1

    activities.sort(key=parse_local_datetime)
    recompute_streaks(activities)

    if not dry_run:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with output_file.open("w", encoding="utf-8") as f:
            json.dump(activities, f, ensure_ascii=False)

    return imported, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Apple Watch GPX workouts.")
    parser.add_argument(
        "source_dir",
        nargs="?",
        default=os.environ.get("APPLE_WORKOUTS_DIR", str(DEFAULT_SOURCE_DIR)),
        help="directory containing Apple Watch GPX files",
    )
    parser.add_argument(
        "--output",
        default=JSON_FILE,
        help="activities JSON output path",
    )
    parser.add_argument(
        "--timezone",
        default=os.environ.get("APPLE_WORKOUT_TIMEZONE", DEFAULT_TIMEZONE),
        help="timezone used for local workout dates",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source_dir = Path(args.source_dir).expanduser()
    if not source_dir.exists():
        raise SystemExit(f"Apple workout directory does not exist: {source_dir}")

    imported, skipped = import_apple_workouts(
        source_dir=source_dir,
        output_file=Path(args.output),
        timezone_name=args.timezone,
        dry_run=args.dry_run,
    )
    action = "Would import" if args.dry_run else "Imported"
    print(f"{action} {imported} Apple Watch run(s); skipped {skipped}.")


if __name__ == "__main__":
    main()
