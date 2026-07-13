#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.ianyilin.running-page.apple-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$ROOT_DIR/logs"
DEFAULT_WORKOUTS_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Running Workouts"
WORKOUTS_DIR="${APPLE_WORKOUTS_DIR:-$DEFAULT_WORKOUTS_DIR}"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT_DIR/scripts/sync-apple-workouts.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>APPLE_WORKOUTS_DIR</key>
    <string>$WORKOUTS_DIR</string>
    <key>APPLE_WORKOUT_TIMEZONE</key>
    <string>America/New_York</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>23</integer>
    <key>Minute</key>
    <integer>10</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/apple-sync.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/apple-sync.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Installed $LABEL"
echo "Workout folder: $WORKOUTS_DIR"
echo "Logs: $LOG_DIR/apple-sync.out.log and $LOG_DIR/apple-sync.err.log"
