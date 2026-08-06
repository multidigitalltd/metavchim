#!/bin/sh
# ============================================================
# עותק גיבוי מחוץ לשרת — rclone אל אחסון תואם-S3
# (Cloudflare R2 / Backblaze B2 / AWS S3 / Wasabi…).
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
archive="offsite:${OFFSITE_S3_BUCKET}/metavchim-archive"
echo "[offsite] סנכרון גיבויים כל 6 שעות אל ${dest}"

while true; do
  # ------------------------------------------------------------------
  # הגנה קריטית: rclone sync משקף מחיקות. אם תיקיית הגיבויים המקומית
  # התרוקנה — דיסק שנפל, mount שלא עלה, סקריפט שגוי — הסנכרון הבא היה
  # מוחק גם את העותק המרוחק, כלומר הורס בדיוק את מה שאמור להציל.
  # לכן: אין קבצים מקומיים ⇒ לא נוגעים ביעד.
  # ------------------------------------------------------------------
  count=$(find /backups -type f ! -name '*.tmp' 2>/dev/null | head -1 | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "[offsite] ✗ תיקיית הגיבויים המקומית ריקה — הסנכרון דולג כדי לא למחוק את העותק המרוחק" >&2
  else
    # --backup-dir: קובץ שנמחק או הוחלף עובר לארכיון עם חותמת תאריך
    # במקום להימחק. מחיקה שגויה ניתנת לשחזור.
    if rclone sync /backups "$dest" \
        --exclude "*.tmp" \
        --backup-dir "${archive}/$(date +%Y-%m-%d)" \
        --transfers 2 \
        --stats-one-line --stats 0; then
      echo "[offsite] ✓ סונכרן — $(date)"
    else
      echo "[offsite] ✗ הסנכרון נכשל — ניסיון נוסף בעוד 6 שעות" >&2
    fi
  fi
  sleep 21600
done
