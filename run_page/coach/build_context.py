import datetime as dt
import json
import statistics
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
ACTIVITIES_FILE = ROOT / "src" / "static" / "activities.json"
OUTPUT_DIR = ROOT / "run_page" / "coach_output"
CONTEXT_FILE = OUTPUT_DIR / "coach_input.json"
LOCAL_TZ = ZoneInfo("America/New_York")


def _parse_duration(value) -> int:
    if not value:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    parts = str(value).split(".")[0].split(":")
    if len(parts) != 3:
        return 0
    hours, minutes, seconds = [int(part) for part in parts]
    return hours * 3600 + minutes * 60 + seconds


def _parse_local_datetime(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%d %H:%M:%S")


def _pace_min_per_km(distance_m: float, moving_seconds: int) -> float | None:
    if not distance_m or distance_m <= 0 or moving_seconds <= 0:
        return None
    return round((moving_seconds / 60) / (distance_m / 1000), 2)


def _safe_mean(values: list[float | None]) -> float | None:
    filtered = [v for v in values if v is not None]
    if not filtered:
        return None
    return round(statistics.mean(filtered), 1)


def _run_type(run: dict) -> str:
    name = str(run.get("name") or "").lower()
    distance_km = run.get("distance_km") or 0
    moving_min = run.get("moving_time_min") or 0
    avg_hr = run.get("average_heartrate")

    if "interval" in name or "间歇" in name:
        return "interval"
    if distance_km >= 14 or moving_min >= 90:
        return "long"
    if avg_hr is not None and avg_hr >= 160:
        return "hard"
    if avg_hr is not None and avg_hr >= 150:
        return "moderate"
    return "easy"


def _normalize_activity(activity: dict) -> dict:
    distance_m = float(activity.get("distance") or 0)
    moving_seconds = _parse_duration(activity.get("moving_time"))
    start_local = _parse_local_datetime(activity["start_date_local"])
    run = {
        "run_id": activity.get("run_id"),
        "date": start_local.date().isoformat(),
        "start_time_local": start_local.strftime("%H:%M"),
        "name": activity.get("name"),
        "distance_km": round(distance_m / 1000, 2),
        "moving_time_min": round(moving_seconds / 60, 1),
        "pace_min_per_km": _pace_min_per_km(distance_m, moving_seconds),
        "average_heartrate": activity.get("average_heartrate"),
        "average_speed_mps": activity.get("average_speed"),
        "elevation_gain_m": activity.get("elevation_gain"),
        "subtype": activity.get("subtype"),
        "streak": activity.get("streak"),
    }
    run["inferred_type"] = _run_type(run)
    return run


def _summarize(runs: list[dict], days: int, end_date: dt.date) -> dict:
    start_date = end_date - dt.timedelta(days=days - 1)
    window = [
        run
        for run in runs
        if start_date <= dt.date.fromisoformat(run["date"]) <= end_date
    ]
    total_distance = round(sum(run["distance_km"] for run in window), 2)
    total_minutes = round(sum(run["moving_time_min"] for run in window), 1)
    longest_run = max(window, key=lambda run: run["distance_km"], default=None)
    hard_types = {"interval", "hard", "long"}
    hard_runs = [run for run in window if run["inferred_type"] in hard_types]

    return {
        "days": days,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "run_count": len(window),
        "total_distance_km": total_distance,
        "total_time_min": total_minutes,
        "average_distance_km": round(total_distance / len(window), 2)
        if window
        else 0,
        "average_heartrate": _safe_mean([run.get("average_heartrate") for run in window]),
        "hard_run_count": len(hard_runs),
        "longest_run": longest_run,
    }


def _guardrails(runs: list[dict], end_date: dt.date) -> dict:
    last_run = runs[-1] if runs else None
    last_run_date = dt.date.fromisoformat(last_run["date"]) if last_run else None
    days_since_last_run = (end_date - last_run_date).days if last_run_date else None

    last_7 = _summarize(runs, 7, end_date)
    prev_end = end_date - dt.timedelta(days=7)
    prev_7 = _summarize(runs, 7, prev_end)
    last_3 = [
        run
        for run in runs
        if end_date - dt.timedelta(days=2)
        <= dt.date.fromisoformat(run["date"])
        <= end_date
    ]

    load_ratio = None
    if prev_7["total_distance_km"] > 0:
        load_ratio = round(last_7["total_distance_km"] / prev_7["total_distance_km"], 2)

    reasons = []
    fatigue_signal = "low"
    recommended_guardrail = "normal_training_ok"

    if last_run and last_run["inferred_type"] in {"interval", "hard", "long"}:
        fatigue_signal = "medium"
        recommended_guardrail = "easy_only"
        reasons.append(f"last run was {last_run['inferred_type']}")

    if len([run for run in last_3 if run["inferred_type"] in {"interval", "hard", "long"}]) >= 2:
        fatigue_signal = "high"
        recommended_guardrail = "rest_or_recovery"
        reasons.append("two harder efforts in the last 3 days")

    if load_ratio is not None and load_ratio >= 1.35 and last_7["total_distance_km"] >= 15:
        fatigue_signal = "high"
        recommended_guardrail = "easy_only"
        reasons.append("7-day distance increased sharply versus previous week")

    if days_since_last_run is not None and days_since_last_run >= 3:
        recommended_guardrail = "easy_comeback"
        reasons.append("several days since last run")

    return {
        "fatigue_signal": fatigue_signal,
        "recommended_guardrail": recommended_guardrail,
        "days_since_last_run": days_since_last_run,
        "last_7_vs_previous_7_distance_ratio": load_ratio,
        "reasons": reasons,
    }


def build_context(
    activities_file: Path = ACTIVITIES_FILE,
    output_file: Path = CONTEXT_FILE,
    today: dt.date | None = None,
) -> dict:
    activities = json.loads(activities_file.read_text(encoding="utf-8"))
    runs = [
        _normalize_activity(activity)
        for activity in activities
        if activity.get("type") == "Run" and activity.get("start_date_local")
    ]
    runs.sort(key=lambda run: (run["date"], run["start_time_local"]))

    if today is None:
        today = dt.datetime.now(LOCAL_TZ).date()
        if runs:
            latest_run_date = dt.date.fromisoformat(runs[-1]["date"])
            today = max(today, latest_run_date)

    context = {
        "generated_at": dt.datetime.now(LOCAL_TZ).isoformat(timespec="seconds"),
        "analysis_date": today.isoformat(),
        "target_date": (today + dt.timedelta(days=1)).isoformat(),
        "source": {
            "activities_file": str(activities_file.relative_to(ROOT)),
            "run_count_total": len(runs),
        },
        "recent_runs": runs[-14:],
        "summary": {
            "last_7_days": _summarize(runs, 7, today),
            "last_14_days": _summarize(runs, 14, today),
            "last_28_days": _summarize(runs, 28, today),
        },
        "signals": _guardrails(runs, today),
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(
        json.dumps(context, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return context
