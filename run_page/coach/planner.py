import datetime as dt

from coach.workout_library import get_workout_template


QUALITY_TYPES = {"interval", "hard", "tempo", "long"}
DISTANCE_LABELS = {
    "5k": 5.0,
    "10k": 10.0,
    "half_marathon": 21.0975,
    "full_marathon": 42.195,
}


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


def _parse_duration_to_minutes(value) -> float | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    value = str(value)
    parts = [int(part) for part in value.split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        return minutes + seconds / 60
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return hours * 60 + minutes + seconds / 60
    return None


def _format_pace(value: float | None) -> str | None:
    if value is None:
        return None
    minutes = int(value)
    seconds = round((value - minutes) * 60)
    if seconds == 60:
        minutes += 1
        seconds = 0
    return f"{minutes}:{seconds:02d}/km"


def _pace_range(center: float | None, low_delta: float, high_delta: float) -> dict | None:
    if center is None:
        return None
    low = max(center + low_delta, 3.0)
    high = max(center + high_delta, low + 0.05)
    return {
        "min": round(low, 2),
        "max": round(high, 2),
        "display": f"{_format_pace(low)} - {_format_pace(high)}",
    }


def _manual_benchmarks(context: dict) -> dict:
    out = {}
    for item in context.get("profile", {}).get("performance_benchmarks", []) or []:
        label = item.get("distance")
        minutes = _parse_duration_to_minutes(item.get("time"))
        distance_km = DISTANCE_LABELS.get(label or "")
        if label and minutes and distance_km:
            out[label] = {
                "distance": label,
                "distance_km": distance_km,
                "time": item["time"],
                "pace_min_per_km": round(minutes / distance_km, 2),
                "date": item.get("date"),
                "source": "manual",
            }
    return out


def _auto_benchmarks(context: dict) -> dict:
    runs = context.get("recent_runs", [])
    out = {}
    for label, distance_km in DISTANCE_LABELS.items():
        candidates = [
            run
            for run in runs
            if float(run.get("distance_km") or 0) >= distance_km * 0.95
            and run.get("pace_min_per_km")
        ]
        if not candidates:
            continue
        best = min(candidates, key=lambda run: float(run["pace_min_per_km"]))
        pace = float(best["pace_min_per_km"])
        estimated_minutes = pace * distance_km
        out[label] = {
            "distance": label,
            "distance_km": distance_km,
            "estimated_time_min": round(estimated_minutes, 1),
            "pace_min_per_km": round(pace, 2),
            "source": "auto_history",
            "source_run_id": best.get("run_id"),
            "source_date": best.get("date"),
            "note": "Estimated from whole-activity pace, not split-level best effort.",
        }
    return out


def _performance_model(context: dict) -> dict:
    manual = _manual_benchmarks(context)
    auto = _auto_benchmarks(context)
    combined = auto.copy()
    combined.update(manual)

    easy_paces = [
        float(run["pace_min_per_km"])
        for run in context.get("recent_runs", [])
        if run.get("pace_min_per_km") and run.get("inferred_type") in {"easy", "moderate"}
    ]
    easy_pace = sum(easy_paces[-6:]) / len(easy_paces[-6:]) if easy_paces else None
    ten_k_pace = combined.get("10k", {}).get("pace_min_per_km")
    five_k_pace = combined.get("5k", {}).get("pace_min_per_km")

    if easy_pace is None and ten_k_pace:
        easy_pace = ten_k_pace + 1.0

    pace_targets = {
        "recovery_run": _pace_range(easy_pace, 0.35, 0.95),
        "easy_run": _pace_range(easy_pace, 0.0, 0.45),
        "long_run": _pace_range(easy_pace, 0.1, 0.65),
        "steady_run": _pace_range(easy_pace, -0.3, 0.1),
        "tempo": _pace_range(ten_k_pace, 0.25, 0.55)
        or _pace_range(easy_pace, -0.65, -0.25),
        "intervals": _pace_range(five_k_pace, -0.1, 0.2)
        or _pace_range(easy_pace, -1.0, -0.55),
    }
    return {
        "manual_benchmarks": manual,
        "auto_benchmarks": auto,
        "benchmarks": combined,
        "pace_targets": pace_targets,
    }


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


def _training_cycle(goal: dict | None, phase: str) -> dict:
    if not goal:
        return {"phase": phase, "blocks": []}
    goal_date = dt.date.fromisoformat(goal["date"])
    blocks = [
        {
            "phase": "base_building",
            "start_date": (goal_date - dt.timedelta(days=180)).isoformat(),
            "end_date": (goal_date - dt.timedelta(days=113)).isoformat(),
            "focus": "Build durable easy volume and consistent long runs.",
        },
        {
            "phase": "specific_endurance",
            "start_date": (goal_date - dt.timedelta(days=112)).isoformat(),
            "end_date": (goal_date - dt.timedelta(days=57)).isoformat(),
            "focus": "Add controlled steady/tempo work while growing endurance.",
        },
        {
            "phase": "race_specific",
            "start_date": (goal_date - dt.timedelta(days=56)).isoformat(),
            "end_date": (goal_date - dt.timedelta(days=29)).isoformat(),
            "focus": "Practice goal-specific endurance and fueling.",
        },
        {
            "phase": "peak",
            "start_date": (goal_date - dt.timedelta(days=28)).isoformat(),
            "end_date": (goal_date - dt.timedelta(days=11)).isoformat(),
            "focus": "Peak race-specific fitness without excessive fatigue.",
        },
        {
            "phase": "taper",
            "start_date": (goal_date - dt.timedelta(days=10)).isoformat(),
            "end_date": goal_date.isoformat(),
            "focus": "Reduce volume, keep rhythm, arrive fresh.",
        },
    ]
    return {"phase": phase, "blocks": blocks}


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


def _actual_for_date(context: dict, date: dt.date) -> dict | None:
    runs = [
        run for run in context.get("recent_runs", []) if _run_date(run) == date
    ]
    if not runs:
        return None
    return {
        "run_count": len(runs),
        "distance_km": round(sum(float(run.get("distance_km") or 0) for run in runs), 1),
        "duration_min": round(sum(float(run.get("moving_time_min") or 0) for run in runs), 1),
        "workout_types": [run.get("inferred_type") for run in runs],
        "feedback_tags": sorted({tag for run in runs for tag in run.get("feedback_tags", [])}),
    }


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


def _build_structured_workout(
    workout_type: str,
    duration_min: int,
    target_hr_zone: str | None,
    target_pace: dict | None,
) -> list[dict]:
    template = get_workout_template(workout_type)
    steps = []
    for step in template.get("steps", []):
        item = step.copy()
        if item.get("type") == "run":
            item["duration_min"] = max(
                duration_min
                - sum(s.get("duration_min", 0) for s in template.get("steps", []) if s.get("type") != "run"),
                0,
            )
            if target_hr_zone:
                item["target_hr_zone"] = target_hr_zone
            if target_pace:
                item["target_pace_min_per_km"] = target_pace
        elif item.get("type") == "repeat":
            if target_hr_zone:
                item["target_hr_zone"] = target_hr_zone
            if target_pace:
                item["target_pace_min_per_km"] = target_pace
        steps.append(item)
    return steps


def _decision_for_type(
    context: dict,
    workout_type: str,
    target_date: dt.date,
    long_run_km: float,
    performance: dict,
) -> dict:
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
    target_pace = performance.get("pace_targets", {}).get(workout_type)
    target_hr_zone = template.get("target_hr_zone")
    return {
        "date": target_date.isoformat(),
        "run_or_rest": template["run_or_rest"],
        "workout_type": workout_type,
        "duration_min": duration_min,
        "distance_km": round(distance_km, 1),
        "intensity": template["intensity"],
        "target_hr_zone": target_hr_zone,
        "target_pace_min_per_km": target_pace,
        "warmup": template["warmup"],
        "main_set": template["main_set"],
        "cooldown": template["cooldown"],
        "structured_workout": _build_structured_workout(
            workout_type, duration_min, target_hr_zone, target_pace
        ),
        "hard_session_allowed": workout_type in {"tempo", "intervals", "steady_run", "long_run"},
    }


def _week_plan(
    context: dict,
    target_date: dt.date,
    phase: str,
    weekly_target_km: float,
    long_run_km: float,
    quality_budget: int,
    performance: dict,
) -> list[dict]:
    week_start = target_date - dt.timedelta(days=target_date.weekday())
    plan = []
    quality_used = 0
    long_run_scheduled = False
    planned_km = 0.0
    for offset in range(7):
        day = week_start + dt.timedelta(days=offset)
        actual = _actual_for_date(context, day)
        if actual:
            workout_type = "completed"
            planned_km += float(actual.get("distance_km") or 0)
            if "long" in (actual.get("workout_types") or []):
                long_run_scheduled = True
        elif day < target_date:
            workout_type = "rest"
        elif day == target_date:
            workout_type, _, _ = _choose_workout_type(
                context, phase, weekly_target_km, quality_budget
            )
        elif planned_km >= weekly_target_km * 0.95:
            workout_type = "rest"
        elif day.weekday() in {5, 6} and long_run_scheduled:
            workout_type = "recovery_run" if day.weekday() == 6 else "rest"
        elif day.weekday() in {5, 6} and not long_run_scheduled:
            workout_type = "long_run"
            long_run_scheduled = True
        elif quality_used < quality_budget and phase in {"specific_endurance", "race_specific", "peak"}:
            workout_type = "tempo" if phase != "peak" else "steady_run"
            quality_used += 1
        elif day.weekday() in {2, 4}:
            workout_type = "rest"
        else:
            workout_type = "easy_run"

        planned = None
        if workout_type != "completed":
            planned = _decision_for_type(
                context,
                workout_type,
                day,
                long_run_km,
                performance,
            )
            planned_km += float(planned.get("distance_km") or 0)
        plan.append(
            {
                "date": day.isoformat(),
                "weekday": day.strftime("%a"),
                "status": "completed" if actual else "planned",
                "planned": planned,
                "actual": actual,
            }
        )
    return plan


def build_rule_based_plan(context: dict) -> dict:
    goal = _primary_goal(context)
    phase = _phase_for_goal(goal)
    performance = _performance_model(context)
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
    decision = _decision_for_type(
        context, workout_type, target_date, long_run_km, performance
    )
    week_plan = _week_plan(
        context,
        target_date,
        phase,
        weekly_target_km,
        long_run_km,
        quality_budget,
        performance,
    )

    return {
        "planner_version": "rule_v1",
        "phase": phase,
        "training_cycle": _training_cycle(goal, phase),
        "performance": performance,
        "weekly_target": {
            "distance_km": weekly_target_km,
            "long_run_km": long_run_km,
            "quality_sessions": quality_budget,
        },
        "week_plan": week_plan,
        "decision": decision,
        "constraints": {
            "forbidden_workout_types": sorted(set(forbidden)),
            "guardrail": context.get("signals", {}).get("recommended_guardrail"),
        },
        "reasons": reasons,
    }
