# Apple Watch auto sync

This project can import Apple Watch running routes from GPX files and publish
the page without using the Strava API.

## Data flow

```text
Apple Watch -> iPhone export app -> iCloud Drive GPX folder -> Mac launchd job
-> src/static/activities.json -> GitHub -> ianyilin.github.io/running/
```

GitHub Actions cannot read Apple Health directly from the cloud. The automatic
part therefore runs on this Mac and pushes the updated JSON to GitHub.

## 1. Export GPX files to iCloud Drive

Use an iPhone app that can export Apple Health workout routes as GPX files.
Set the export destination to an iCloud Drive folder, for example:

```text
iCloud Drive/Running Workouts
```

Keep only running GPX files in that folder, because the importer treats every
GPX file there as a run.

## 2. Test one import manually

If your GPX folder is `iCloud Drive/Running Workouts`, run:

```bash
APPLE_WORKOUTS_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Running Workouts" \
  corepack pnpm data:import:apple
```

Then build locally:

```bash
PATH_PREFIX=/running/ corepack pnpm build
```

## 3. Install the nightly Mac automation

The default schedule is 23:10 New York time on this Mac.

```bash
APPLE_WORKOUTS_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Running Workouts" \
  scripts/install-apple-workout-sync.sh
```

The LaunchAgent runs:

```bash
scripts/sync-apple-workouts.sh
```

It imports new GPX files, commits `src/static/activities.json` if it changed,
and pushes to `origin master`. The GitHub workflow then builds and publishes
the `/running/` page.

## Logs

```text
logs/apple-sync.out.log
logs/apple-sync.err.log
```
