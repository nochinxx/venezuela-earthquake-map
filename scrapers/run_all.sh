#!/bin/bash
# Run all earthquake scrapers. Called by launchd every 10 minutes.
# No set -e: each scraper runs independently; one failure won't kill the rest.

export PATH="/opt/homebrew/bin:/opt/homebrew/Caskroom/miniforge/base/bin:/usr/local/bin:/usr/bin:/bin"

REPO=~/code/venezuela-earthquake-map
LOG=~/agent/logs/earthquake-scraper.log
CONDA="conda run -n agent python"

echo "" >> "$LOG"
echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') ===" >> "$LOG"

cd "$REPO"

echo "[youtube]" >> "$LOG"
$CONDA scrapers/youtube.py >> "$LOG" 2>&1 || echo "[youtube] FAILED (exit $?)" >> "$LOG"

echo "[twitter]" >> "$LOG"
$CONDA scrapers/twitter_search.py >> "$LOG" 2>&1 || echo "[twitter] FAILED (exit $?)" >> "$LOG"

echo "[instagram]" >> "$LOG"
$CONDA scrapers/instagram_search.py >> "$LOG" 2>&1 || echo "[instagram] FAILED (exit $?)" >> "$LOG"

# Transcription + casualties run every 3rd cycle (~30 min)
MINUTE=$(date +%M)
if [ "$MINUTE" -lt 10 ] || { [ "$MINUTE" -gt 40 ] && [ "$MINUTE" -lt 50 ]; }; then
    echo "[transcribe]" >> "$LOG"
    $CONDA scrapers/transcribe_youtube.py >> "$LOG" 2>&1 || echo "[transcribe] FAILED (exit $?)" >> "$LOG"

    echo "[casualties]" >> "$LOG"
    $CONDA scrapers/casualties.py >> "$LOG" 2>&1 || echo "[casualties] FAILED (exit $?)" >> "$LOG"

    echo "[yt-comments]" >> "$LOG"
    $CONDA scrapers/youtube_comments.py >> "$LOG" 2>&1 || echo "[yt-comments] FAILED (exit $?)" >> "$LOG"

    echo "[x-comments]" >> "$LOG"
    $CONDA scrapers/twitter_comments.py >> "$LOG" 2>&1 || echo "[x-comments] FAILED (exit $?)" >> "$LOG"

    echo "[ig-comments]" >> "$LOG"
    $CONDA scrapers/instagram_comments.py >> "$LOG" 2>&1 || echo "[ig-comments] FAILED (exit $?)" >> "$LOG"

    echo "[relief-centers]" >> "$LOG"
    $CONDA scrapers/relief_centers.py >> "$LOG" 2>&1 || echo "[relief-centers] FAILED (exit $?)" >> "$LOG"

    echo "[missing-persons]" >> "$LOG"
    $CONDA scrapers/missing_persons_scraper.py >> "$LOG" 2>&1 || echo "[missing-persons] FAILED (exit $?)" >> "$LOG"

    echo "[venezulatebusca]" >> "$LOG"
    $CONDA scrapers/venezulatebusca_scraper.py >> "$LOG" 2>&1 || echo "[venezulatebusca] FAILED (exit $?)" >> "$LOG"
fi

# Gemma dedup runs once per hour (minutes 0–9 only, i.e. first cycle of each hour)
# Incremental — only checks records added since last run, so it's fast after the first pass
HOUR_MINUTE=$(date +%M)
if [ "$HOUR_MINUTE" -lt 10 ]; then
    echo "[dedup-gemma]" >> "$LOG"
    $CONDA scrapers/dedup_gemma.py >> "$LOG" 2>&1 || echo "[dedup-gemma] FAILED (exit $?)" >> "$LOG"
fi
