#!/bin/sh
# ============================================================
# עותק גיבוי מחוץ לשרת — rclone sync של תיקיית הגיבויים לאחסון
# ענן תואם-S3 (Backblaze B2 / Cloudflare R2 / AWS S3 / Wasabi…).
# רץ כל 6 שעות; ההגדרות מגיעות ממשתני OFFSITE_S3_* (docs/10).
# ============================================================
set -u

if [ -z "${RCLONE_CONFIG_OFFSITE_ENDPOINT:-}" ] || \
   [ -z "${RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID:-}" ] || \
   [ -z "${RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY:-}" ] || \
   [ -z "${OFFSITE_S3_BUCKET:-}" ]; then
  echo "[offsite] ✗ חסרות הגדרות OFFSITE_S3_* ב-.env.production — ראו docs/10-deployment.md" >&2
  # יציאה עם שגיאה: restart של compose ינסה שוב, והלוג מסביר מה חסר
  exit 1
fi

dest="offsite:${OFFSITE_S3_BUCKET}/metavchim-backups"
echo "[offsite] סנכרון גיבויים כל 6 שעות אל ${dest}"

while true; do
  if rclone sync /backups "$dest" --exclude "*.tmp" --transfers 2 --stats-one-line --stats 0; then
    echo "[offsite] ✓ סונכרן — $(date)"
  else
    echo "[offsite] ✗ הסנכרון נכשל — ניסיון נוסף בעוד 6 שעות" >&2
  fi
  sleep 21600
done
