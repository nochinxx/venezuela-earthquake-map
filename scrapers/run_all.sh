#!/bin/bash
# Run all earthquake scrapers. Called by launchd every 10 minutes.
set -e

export PATH="/opt/homebrew/bin:/opt/homebrew/Caskroom/miniforge/base/bin:/usr/local/bin:/usr/bin:/bin"

REPO=~/code/venezuela-earthquake-map
LOG=~/agent/logs/earthquake-scraper.log
CONDA="conda run -n agent python"

echo "" >> "$LOG"
echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') ===" >> "$LOG"

cd "$REPO"

echo "[youtube]" >> "$LOG"
$CONDA scrapers/youtube.py >> "$LOG" 2>&1

echo "[twitter]" >> "$LOG"
$CONDA scrapers/twitter_search.py >> "$LOG" 2>&1

echo "[instagram]" >> "$LOG"
$CONDA scrapers/instagram_search.py >> "$LOG" 2>&1

# Transcription runs every 3rd cycle (~30 min) — subtitles take time to generate
MINUTE=$(date +%M)
if [ "$MINUTE" -lt 10 ] || [ "$MINUTE" -gt 40 ] && [ "$MINUTE" -lt 50 ]; then
    echo "[transcribe]" >> "$LOG"
    $CONDA scrapers/transcribe_youtube.py >> "$LOG" 2>&1
fi
