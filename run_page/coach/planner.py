import datetime as dt

from coach.workout_library import get_workout_template


QUALITY_TYPES = {"interval", "hard", "tempo", "long"}


def _run_date(run: dict) -> dt.date:
    return dt.date.fromisoformat(run["date"])


def _runs_between(runs: list[dict], start: dt.date, end: dt.date) -> list[dict]:
    return [run for run in runs if start <= _run_date(run) <= end]


def _primary_goal(context: dict) -> dict | None:
    return context.get("goals", {}).get("primary_goal")


def _phase_for_goal(goal: dict | None) -> str:
    if not goal:
        return "maintenance"

    days_until = goal.get("days_until")
    if days_until is None:
        return "maintenance"
    if days_until <= 10:
        return "taper"
    if days_until <= 28:
        return "peak"
    if days_until <= 56:
        return "race_specific"
    if days_until <= 112:
        return "specific_endurance"
    return "base_building"


def _goal_distance_km(goal: dict | None) -> float | None:
    if not goal:
        return None
    distance = goal.get("distance_km")
    return float(distance) if distance is not None else None


def _weekly_target_distance(context: dict, phase: str, goal: dict | None) -> float:
    last_28 = context.get("summary", {}).get("last_28_days", {})
    last_7 = context.get("summary", {}).get("last_7_days", {})
    current_week = float(last_7.get("total_distance_km") or 0)
    recent_week_avg = float(last_28.get("total_distance_km") or 0) / 4
    baseline = max(recent_week_avg, current_week * 0.85, 15)

    phase_multiplier = {
        "maintenance": 1.0,
        "base_building": 1.03,
        "specific_endurance": 1.06,
        "race_specific": 1.03,
        "peak": 0.9,
        "taper": 0.55,
    }.get(phase, 1.0)

    goal_distance = _goal_distance_km(goal)
    if goal_distance:
        if goal_distance >= 42:
            cap = 70
        elif goal_distance >= 21:
            cap = 55
        elif goal_distance >= 10:
            cap = 40
        else:
            cap = 30
    else:
        cap = max(baseline * 1.15, 25)

    target = min(baseline * phase_multiplier, baseline * 1.12, cap)
    return round(max(target, 10), 1)


def _long_run_target(context: dict, weekly_target_km: float, goal: dict | None) -> float:
    longest = context.get("summary", {}).get("last_28_days", {}).get("longest_run")
    recent_long = float(longest.get("distance_km") or 0) if longest else 0
    goal_distance = _goal_distance_km(goal)

    target = max(recent_long * 1.05, weekly_target_km * 0.3)
    if goal_distance:
        target = min(target, goal_distance * 0.85)
    return round(max(target, 6), 1)


def _quality_budget(phase: str, weekly_target_km: float) -> int:
    if phase in {"maintenance", "base_building", "taper"}:
        return 1 if weekly_target_km >= 25 else 0
    if phase in {"specific_endurance", "race_specific", "peak"}:
        return 2 if weekly_target_km >= 35 else 1
    return 1


def _weekday(date_text: str) -> str:
    return dt.date.fromisoformat(date_text).strftime("%a")


def _preferences(context: dict) -> dict:
    return context.get("profile", {}).get("running_preferences", {}) or {}


def _preferred_duration(context: dict, target_date: dt.date, workout_type: str) -> int:
    prefs = _preferences(context)
    is_weekend = target_date.weekday() >= 5
    available = (
        prefs.get("available_time_weekend_min")
        if is_weekend
        else prefs.get("available_time_weekday_min")
    )
    default_by_type = {
        "rest": 0,
        "recovery_run": 30,
        "easy_run": 40,
        "steady_run": 45,
        "tempo": 50,
        "intervals": 50,
        "long_run": 75,
    }
    duration = default_by_type.get(workout_type, 40)
    if available:
        duration = min(duration, int(available))
    return max(duration, 0)


def _distance_from_duration(context: dict, duration_min: int) -> float:
    recent = context.get("recent_runs", [])
    paces = [
        float(run["pace_min_per_km"])
        for run in recent
        if run.get("pace_min_per_km") and run.get("inferred_type") in {"easy", "moderate"}
    ]
    pace = sum(paces[-5:]) / len(paces[-5:]) if paces else 7.0
    return round(duration_min / pace, 1) if duration_min > 0 else 0


def _recent_quality_count(runs: list[dict], start: dt.date, end: dt.date) -> int:
    return len(
        [
            run
            for run in _runs_between(runs, start, end)
            if run.get("inferred_type") in QUALITY_TYPES
        ]
    )


def _choose_workout_type(
    context: dict,
    phase: str,
    weekly_target_km: float,
    quality_budget: int,
) -> tuple[str, list[str], list[str]]:
    target_date = dt.date.fromisoformat(context["target_date"])
    analysis_date = dt.date.fromisoformat(context["analysis_date"])
    recent = context.get("recent_runs", [])
    signals = context.get("signals", {})
    prefs = _preferences(context)
    reasons = []
    forbidden = []

    guardrail = signals.get("recommended_guardrail")
    if guardrail == "rest_or_recovery":
        reasons.append("guardrail requires rest or recovery after recent hard load")
        return "rest", reasons, ["tempo", "intervals", "long_run", "steady_run"]
    if guardrail in {"easy_only", "easy_comeback"}:
        reasons.append(f"guardrail is {guardrail}, so no quality workout is allowed")
        forbidden.extend(["tempo", "intervals", "long_run", "steady_run"])

    if _weekday(context["target_date"]) in (prefs.get("preferred_rest_days") or []):
        reasons.append("target date is a preferred rest day")
        return "rest", reasons, ["tempo", "intervals", "long_run", "steady_run", "easy_run"]

    week_start = analysis_date - dt.timedelta(days=analysis_date.weekday())
    current_week_runs = _runs_between(recent, week_start, analysis_date)
    current_week_km = sum(float(run.get("distance_km") or 0) for run in current_week_runs)
    remaining_week_km = max(weekly_target_km - current_week_km, 0)
    recent_quality = _recent_quality_count(recent, analysis_date - dt.timedelta(days=6), analysis_date)

    if current_week_km >= weekly_target_km * 1.05:
        reasons.append("current week is already at or above target distance")
        return "recovery_run", reasons, forbidden + ["tempo", "intervals", "long_run"]

    if target_date.weekday() in {5, 6} and guardrail not in {"easy_only", "easy_comeback"}:
        reasons.append("weekend day is suitable for the long run")
        return "long_run", reasons, forbidden

    if recent_quality < quality_budget and phase in {"specific_endurance", "race_specific", "peak"}:
        workout_type = "tempo" if phase != "peak" else "steady_run"
        reasons.append("weekly quality budget has room for a controlled workout")
        return workout_type, reasons, forbidden

    if remaining_week_km <= 5:
        reasons.append("only a small amount of weekly distance remains")
        return "recovery_run", reasons, forbidden

    reasons.append("default choice supports aerobic consistency with low injury risk")
    return "easy_run", reasons, forbidden


def build_rule_based_plan(context: dict) -> dict:
    goal = _primary_goal(context)
    phase = _phase_for_goal(goal)
    weekly_target_km = _weekly_target_distance(context, phase, goal)
    long_run_km = _long_run_target(context, weekly_target_km, goal)
    quality_budget = _quality_budget(phase, weekly_target_km)
    workout_type, reasons, forbidden = _choose_workout_type(
        context,
        phase,
        weekly_target_km,
        quality_budget,
    )

    target_date = dt.date.fromisoformat(context["target_date"])
    duration_min = _preferred_duration(context, target_date, workout_type)
    distance_km = _distance_from_duration(context, duration_min)

    if workout_type == "long_run":
        distance_km = min(max(distance_km, long_run_km * 0.85), long_run_km)
        duration_min = max(duration_min, int(distance_km * 7))
    elif workout_type in {"tempo", "intervals", "steady_run"}:
        distance_km = max(distance_km, 6)
    elif workout_type == "recovery_run":
        distance_km = min(distance_km, 5)

    template = get_workout_template(workout_type)
    decision = {
        "date": context["target_date"],
        "run_or_rest": template["run_or_rest"],
        "workout_type": workout_type,
        "duration_min": duration_min,
        "distance_km": round(distance_km, 1),
        "intensity": template["intensity"],
        "warmup": template["warmup"],
        "main_set": template["main_set"],
        "cooldown": template["cooldown"],
        "hard_session_allowed": workout_type in {"tempo", "intervals", "steady_run", "long_run"},
    }

    return {
        "planner_version": "rule_v1",
        "phase": phase,
        "weekly_target": {
            "distance_km": weekly_target_km,
            "long_run_km": long_run_km,
            "quality_sessions": quality_budget,
        },
        "decision": decision,
        "constraints": {
            "forbidden_workout_types": sorted(set(forbidden)),
            "guardrail": context.get("signals", {}).get("recommended_guardrail"),
        },
        "reasons": reasons,
    }
