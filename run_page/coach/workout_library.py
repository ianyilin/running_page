WORKOUT_TEMPLATES = {
    "rest": {
        "run_or_rest": "rest",
        "intensity": "rest",
        "target_hr_zone": None,
        "warmup": "Optional 5-10 min walk",
        "main_set": "Rest day. Optional easy walk and light mobility.",
        "cooldown": "Gentle stretching if it feels good.",
        "steps": [
            {"name": "Rest", "type": "rest", "duration_min": 0, "target": "rest"}
        ],
    },
    "recovery_run": {
        "run_or_rest": "run",
        "intensity": "RPE 2-3 / very easy",
        "target_hr_zone": "zone 1-2",
        "warmup": "5-10 min walk or very easy jog",
        "main_set": "Very easy run. Keep breathing relaxed and effort low.",
        "cooldown": "5 min walk, then light calf and hip mobility.",
        "steps": [
            {"name": "Warm up", "type": "warmup", "duration_min": 8, "target": "easy"},
            {"name": "Recovery run", "type": "run", "duration_min": 20, "target": "zone 1-2"},
            {"name": "Cool down", "type": "cooldown", "duration_min": 5, "target": "walk"},
        ],
    },
    "easy_run": {
        "run_or_rest": "run",
        "intensity": "RPE 3-4 / conversational",
        "target_hr_zone": "zone 2",
        "warmup": "5-10 min easy jog with light dynamic drills",
        "main_set": "Easy aerobic running. Keep the effort controlled throughout.",
        "cooldown": "5 min easy jog or walk, then light stretching.",
        "steps": [
            {"name": "Warm up", "type": "warmup", "duration_min": 8, "target": "easy"},
            {"name": "Easy run", "type": "run", "duration_min": 30, "target": "zone 2"},
            {"name": "Cool down", "type": "cooldown", "duration_min": 5, "target": "walk"},
        ],
    },
    "steady_run": {
        "run_or_rest": "run",
        "intensity": "RPE 5-6 / steady but controlled",
        "target_hr_zone": "zone 3",
        "warmup": "10 min easy jog with light drills",
        "main_set": "Steady aerobic running. No racing, no surges.",
        "cooldown": "10 min easy jog or walk.",
        "steps": [
            {"name": "Warm up", "type": "warmup", "duration_min": 10, "target": "zone 2"},
            {"name": "Steady run", "type": "run", "duration_min": 25, "target": "zone 3"},
            {"name": "Cool down", "type": "cooldown", "duration_min": 10, "target": "zone 1-2"},
        ],
    },
    "tempo": {
        "run_or_rest": "run",
        "intensity": "RPE 6-7 / comfortably hard",
        "target_hr_zone": "zone 3-4",
        "warmup": "10-15 min easy jog plus 4 short strides",
        "main_set": "Tempo blocks at controlled effort with easy recovery.",
        "cooldown": "10 min easy jog.",
        "steps": [
            {"name": "Warm up", "type": "warmup", "duration_min": 12, "target": "zone 2"},
            {"name": "Tempo", "type": "run", "duration_min": 20, "target": "zone 3-4"},
            {"name": "Cool down", "type": "cooldown", "duration_min": 10, "target": "zone 1-2"},
        ],
    },
    "intervals": {
        "run_or_rest": "run",
        "intensity": "RPE 7-8 / hard but repeatable",
        "target_hr_zone": "zone 4",
        "warmup": "15 min easy jog plus drills and 4 short strides",
        "main_set": "Short controlled intervals with full easy recoveries.",
        "cooldown": "10 min easy jog.",
        "steps": [
            {"name": "Warm up", "type": "warmup", "duration_min": 15, "target": "zone 2"},
            {"name": "Intervals", "type": "repeat", "repetitions": 5, "work_min": 3, "recovery_min": 2, "target": "zone 4"},
            {"name": "Cool down", "type": "cooldown", "duration_min": 10, "target": "zone 1-2"},
        ],
    },
    "long_run": {
        "run_or_rest": "run",
        "intensity": "RPE 3-4 / easy endurance",
        "target_hr_zone": "zone 2",
        "warmup": "10 min easy jog",
        "main_set": "Long easy run. Keep the first half especially relaxed.",
        "cooldown": "5-10 min walk and mobility.",
        "steps": [
            {"name": "Warm up", "type": "warmup", "duration_min": 10, "target": "zone 2"},
            {"name": "Long run", "type": "run", "duration_min": 65, "target": "zone 2"},
            {"name": "Cool down", "type": "cooldown", "duration_min": 8, "target": "walk"},
        ],
    },
}


def get_workout_template(workout_type: str) -> dict:
    return WORKOUT_TEMPLATES.get(workout_type, WORKOUT_TEMPLATES["easy_run"]).copy()
