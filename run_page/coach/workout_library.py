WORKOUT_TEMPLATES = {
    "rest": {
        "run_or_rest": "rest",
        "intensity": "rest",
        "warmup": "Optional 5-10 min walk",
        "main_set": "Rest day. Optional easy walk and light mobility.",
        "cooldown": "Gentle stretching if it feels good.",
    },
    "recovery_run": {
        "run_or_rest": "run",
        "intensity": "RPE 2-3 / very easy",
        "warmup": "5-10 min walk or very easy jog",
        "main_set": "Very easy run. Keep breathing relaxed and effort low.",
        "cooldown": "5 min walk, then light calf and hip mobility.",
    },
    "easy_run": {
        "run_or_rest": "run",
        "intensity": "RPE 3-4 / conversational",
        "warmup": "5-10 min easy jog with light dynamic drills",
        "main_set": "Easy aerobic running. Keep the effort controlled throughout.",
        "cooldown": "5 min easy jog or walk, then light stretching.",
    },
    "steady_run": {
        "run_or_rest": "run",
        "intensity": "RPE 5-6 / steady but controlled",
        "warmup": "10 min easy jog with light drills",
        "main_set": "Steady aerobic running. No racing, no surges.",
        "cooldown": "10 min easy jog or walk.",
    },
    "tempo": {
        "run_or_rest": "run",
        "intensity": "RPE 6-7 / comfortably hard",
        "warmup": "10-15 min easy jog plus 4 short strides",
        "main_set": "Tempo blocks at controlled effort with easy recovery.",
        "cooldown": "10 min easy jog.",
    },
    "intervals": {
        "run_or_rest": "run",
        "intensity": "RPE 7-8 / hard but repeatable",
        "warmup": "15 min easy jog plus drills and 4 short strides",
        "main_set": "Short controlled intervals with full easy recoveries.",
        "cooldown": "10 min easy jog.",
    },
    "long_run": {
        "run_or_rest": "run",
        "intensity": "RPE 3-4 / easy endurance",
        "warmup": "10 min easy jog",
        "main_set": "Long easy run. Keep the first half especially relaxed.",
        "cooldown": "5-10 min walk and mobility.",
    },
}


def get_workout_template(workout_type: str) -> dict:
    return WORKOUT_TEMPLATES.get(workout_type, WORKOUT_TEMPLATES["easy_run"]).copy()
