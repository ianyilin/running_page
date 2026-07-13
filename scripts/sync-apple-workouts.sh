#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_WORKOUTS_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Running Workouts"
export APPLE_WORKOUTS_DIR="${APPLE_WORKOUTS_DIR:-$DEFAULT_WORKOUTS_DIR}"
export APPLE_WORKOUT_TIMEZONE="${APPLE_WORKOUT_TIMEZONE:-America/New_York}"

if [ ! -d "$APPLE_WORKOUTS_DIR" ]; then
  echo "Apple workout directory does not exist: $APPLE_WORKOUTS_DIR"
  echo "Set APPLE_WORKOUTS_DIR to the iCloud Drive folder that contains your GPX files."
  exit 1
fi

git pull --ff-only
corepack pnpm data:import:apple

if git diff --quiet -- src/static/activities.json; then
  echo "No new Apple Watch workouts to publish."
  exit 0
fi

git add src/static/activities.json
git commit -m "import apple watch runs"
git push origin HEAD:master
