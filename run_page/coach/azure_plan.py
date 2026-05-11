import json
import os
import re

import requests


DEFAULT_API_VERSION = "2024-10-21"


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value


def _extract_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.S)
    if not match:
        raise ValueError("Azure OpenAI response did not contain a JSON object")
    return json.loads(match.group(0))


def _fallback_plan(context: dict) -> dict:
    planner = context.get("planner", {})
    if planner.get("decision"):
        decision = planner["decision"].copy()
        decision["rationale"] = "Rule-based planner decision generated without Azure OpenAI."
        decision["cautions"] = planner.get("reasons") or ["Keep the effort controlled."]
        decision["phase"] = planner.get("phase")
        decision["training_cycle"] = planner.get("training_cycle")
        decision["weekly_target"] = planner.get("weekly_target")
        decision["week_plan"] = planner.get("week_plan")
        decision["email_subject"] = (
            f"Training plan: {decision.get('workout_type', 'training').replace('_', ' ')}"
        )
        return decision

    signals = context.get("signals", {})
    summary = context.get("summary", {}).get("last_7_days", {})
    target_date = context["target_date"]
    guardrail = signals.get("recommended_guardrail")

    if guardrail == "rest_or_recovery":
        workout_type = "rest"
        run_or_rest = "rest"
        duration_min = 0
        distance_km = 0
        main_set = "Rest day. Optional 20-30 min easy walk and light mobility."
        intensity = "rest"
    elif guardrail in {"easy_only", "easy_comeback"}:
        workout_type = "easy_run"
        run_or_rest = "run"
        duration_min = 30
        distance_km = 4.5
        main_set = "25-30 min easy conversational running."
        intensity = "easy / zone 2"
    else:
        weekly_distance = summary.get("total_distance_km") or 0
        workout_type = "easy_run"
        run_or_rest = "run"
        duration_min = 35 if weekly_distance >= 20 else 30
        distance_km = 5.5 if weekly_distance >= 20 else 4.5
        main_set = "Easy conversational running. Keep the effort controlled."
        intensity = "easy / zone 2"

    return {
        "date": target_date,
        "run_or_rest": run_or_rest,
        "workout_type": workout_type,
        "duration_min": duration_min,
        "distance_km": distance_km,
        "intensity": intensity,
        "warmup": "5-10 min easy jog or brisk walk",
        "main_set": main_set,
        "cooldown": "5 min walk or very easy jog",
        "rationale": "Rule-based dry run generated from recent Strava load and guardrails.",
        "cautions": signals.get("reasons") or ["Keep the effort comfortable."],
        "email_subject": f"Training plan: {workout_type.replace('_', ' ')}",
    }


def generate_plan(context: dict, dry_run: bool = False) -> dict:
    if dry_run:
        return _fallback_plan(context)

    endpoint = _required_env("AZURE_OPENAI_ENDPOINT").rstrip("/")
    api_key = _required_env("AZURE_OPENAI_API_KEY")
    deployment = _required_env("AZURE_OPENAI_DEPLOYMENT")
    api_version = os.environ.get("AZURE_OPENAI_API_VERSION") or DEFAULT_API_VERSION
    url = (
        f"{endpoint}/openai/deployments/{deployment}/chat/completions"
        f"?api-version={api_version}"
    )

    system_prompt = (
        "You are a conservative running coach. Explain one safe plan for the target date. "
        "The rule-based planner has already selected the workout. You must follow "
        "context.planner.decision for run_or_rest, workout_type, duration_min, "
        "distance_km, and intensity. Do not upgrade the workout or add intensity "
        "that violates context.planner.constraints. "
        "Use the provided running goals as long-term context, including race date, "
        "race distance, target time, and days remaining. "
        "Use the runner profile and health data, such as age, height, weight, heart "
        "rate zones, injury notes, and preferences, when choosing volume and intensity. "
        "Respect the provided guardrail. Do not prescribe a hard workout when the "
        "guardrail says easy_only, easy_comeback, or rest_or_recovery. Return only "
        "valid JSON with the requested keys."
    )
    user_prompt = {
        "task": (
            "Return the target date running plan in Chinese. Preserve the planner decision "
            "fields exactly unless the planner decision is internally inconsistent."
        ),
        "schema": {
            "date": "YYYY-MM-DD",
            "run_or_rest": "run|rest",
            "workout_type": "rest|recovery_run|easy_run|steady_run|tempo|intervals|long_run",
            "duration_min": "number",
            "distance_km": "number",
            "intensity": "short text",
            "target_hr_zone": "zone 2|zone 3|zone 4 or null",
            "target_pace_min_per_km": "object with min/max/display, or null",
            "warmup": "short text",
            "main_set": "short text",
            "cooldown": "short text",
            "structured_workout": "array of executable workout steps from planner decision",
            "rationale": "Chinese explanation",
            "cautions": ["Chinese caution strings"],
            "email_subject": "Chinese email subject",
        },
        "context": context,
    }

    response = requests.post(
        url,
        headers={"api-key": api_key, "Content-Type": "application/json"},
        json={
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
            "temperature": 0.2,
            "max_completion_tokens": 900,
            "response_format": {"type": "json_object"},
        },
        timeout=60,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    plan = _extract_json(content)
    planner = context.get("planner", {})
    decision = planner.get("decision", {})
    for key in [
        "date",
        "run_or_rest",
        "workout_type",
        "duration_min",
        "distance_km",
        "intensity",
        "target_hr_zone",
        "target_pace_min_per_km",
        "structured_workout",
        "hard_session_allowed",
    ]:
        if key in decision:
            plan[key] = decision[key]
    plan.setdefault("date", context["target_date"])
    plan["phase"] = planner.get("phase")
    plan["training_cycle"] = planner.get("training_cycle")
    plan["weekly_target"] = planner.get("weekly_target")
    plan["week_plan"] = planner.get("week_plan")
    plan["performance"] = planner.get("performance")
    return plan
