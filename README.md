# RUN.LOG

Personal Strava running page for `https://ianyilin.github.io/running/`.

This fork is intentionally narrow:

- sync Strava activities only
- show running activities only
- build a React/Vite page under `/running/`
- publish the built `dist/` output into `ianyilin/ianyilin.github.io/running/`

## Local Setup

```bash
pnpm install
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with:

```bash
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_CLIENT_REFRESH_TOKEN=
STRAVA_ONLY_RUN=1
```

## Common Commands

```bash
pnpm data:download:strava   # update run_page/data.db and src/static/activities.json
pnpm coach:dry-run          # generate run_page/coach_output/*.json without Azure/email
pnpm coach:send             # call Azure OpenAI and email the next-day plan
pnpm dev                    # local preview at http://localhost:5173/
PATH_PREFIX=/running/ pnpm build
pnpm check
pnpm lint
```

## Key Files

- `src/pages/index.tsx`: page layout, cards, calendar, activity log, heatmap, race view
- `src/styles/index.css`: visual tokens and page styling
- `src/static/races.json`: manually maintained race records
- `src/utils/const.ts`: map provider and route color settings
- `run_page/strava_sync.py`: GitHub Actions Strava sync entrypoint
- `run_page/strava_env_sync.py`: local `.env` sync entrypoint
- `run_page/coach/`: daily AI coach context, Azure OpenAI call, and SMTP email
- `run_page/coach/planner.py`: deterministic rule-based training planner
- `run_page/coach/workout_library.py`: reusable workout templates
- `run_page/coach/goals.json`: editable upcoming race or training goals
- `run_page/coach/profile.json`: editable runner profile and health context
- `run_page/coach_output/`: latest generated coach input and plan JSON
- `.github/workflows/run_data_sync.yml`: daily cloud sync and `/running/` deployment

## Daily AI Coach

The daily workflow can generate a next-day running plan after Strava sync. It
uses the latest `src/static/activities.json`, writes:

```text
run_page/coach_output/coach_input.json
run_page/coach_output/latest_plan.json
```

The coach uses a two-layer design:

1. `planner.py` makes the training decision with deterministic rules: phase,
   weekly target, long-run target, quality-session budget, and tomorrow's
   workout type/distance/duration.
2. Azure OpenAI turns that structured decision into a Chinese coaching email.
   It should explain the planner decision, not invent a harder workout.

For local testing, first run:

```bash
pnpm coach:dry-run
```

Optional long-term goals live in `run_page/coach/goals.json`. The coach reads
the nearest active future goal and sends it to Azure OpenAI together with recent
training load:

```json
{
  "goals": [
    {
      "name": "Brooklyn Half 2026",
      "date": "2026-05-17",
      "distance": "half_marathon",
      "target_time": "02:00:00",
      "priority": "A",
      "notes": "Primary spring race"
    }
  ]
}
```

Supported distance labels include `5k`, `10k`, `half_marathon`, `full_marathon`,
`半马`, and `全马`. You can also use `"distance_km": 21.0975` directly.

Personal running and health context lives in `run_page/coach/profile.json`. All
fields are optional; fill only the data you want the coach to use:

```json
{
  "profile": {
    "age": 35,
    "sex": "male",
    "height_cm": 175,
    "weight_kg": 70
  },
  "heart_rate": {
    "resting_hr_bpm": 55,
    "max_hr_bpm": 185,
    "zones": [
      { "name": "zone 2", "min_bpm": 125, "max_bpm": 145 },
      { "name": "zone 3", "min_bpm": 146, "max_bpm": 160 }
    ]
  },
  "health": {
    "injury_notes": ["right Achilles sensitive after hills"],
    "sleep_notes": "Prefer easier training after short sleep"
  },
  "running_preferences": {
    "preferred_run_days": ["Tue", "Thu", "Sat", "Sun"],
    "preferred_rest_days": ["Mon"],
    "available_time_weekday_min": 45,
    "available_time_weekend_min": 120,
    "avoid": ["hard workouts on consecutive days"]
  }
}
```

To call Azure OpenAI and send email, fill `.env` or GitHub Actions secrets with:

```text
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT
AZURE_OPENAI_API_VERSION
COACH_EMAIL_TO
COACH_EMAIL_FROM
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
```

## Race Records

Detailed race records live in `src/static/races.json`. Keep the file as a JSON
array. Photos can be remote URLs, or local paths under `public/` such as
`images/races/nyc-2025.jpg`.

```json
[
  {
    "id": "nyc-marathon-2025",
    "activityId": 123456789,
    "date": "2025-11-02",
    "name": "TCS New York City Marathon",
    "subtitle": "First World Marathon Major",
    "category": "Full Marathon",
    "distanceKm": 42.195,
    "location": "New York, NY",
    "officialTime": "03:45:12",
    "chipTime": "03:44:58",
    "result": "Finished",
    "medal": "Finisher Medal",
    "medalImage": "images/races/nyc-2025-medal.jpg",
    "photos": ["images/races/nyc-2025-finish.jpg"],
    "pb": true
  }
]
```

`activityId` is optional. If it matches a Strava activity ID, the manual record
replaces the auto-detected Strava race entry.

## Deployment

GitHub Actions runs `run_data_sync.yml` every day and can also be run manually.
Required repository secrets:

```text
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
STRAVA_CLIENT_REFRESH_TOKEN
HOMEPAGE_DEPLOY_TOKEN
```

`HOMEPAGE_DEPLOY_TOKEN` needs `Contents: Read and write` access to
`ianyilin/ianyilin.github.io`.
