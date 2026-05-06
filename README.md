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
- `run_page/coach_output/`: latest generated coach input and plan JSON
- `.github/workflows/run_data_sync.yml`: daily cloud sync and `/running/` deployment

## Daily AI Coach

The daily workflow can generate a next-day running plan after Strava sync. It
uses the latest `src/static/activities.json`, writes:

```text
run_page/coach_output/coach_input.json
run_page/coach_output/latest_plan.json
```

For local testing, first run:

```bash
pnpm coach:dry-run
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
