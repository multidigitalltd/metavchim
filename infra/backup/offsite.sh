#!/bin/sh
# ============================================================
# עותק גיבוי מחוץ לשרת — rclone אל אחסון תואם-S3
# (Cloudflare R2 / Backblaze B2 / AWS S3 / Wasabi…).
# רץ כל 6 שעות; ההגדרות מגיעות ממשתני OFFSITE_S3_* (docs/10).
#
# אחרי כל מחזור נכתב /state/status.json — הקונטיינר הזה הוא היחיד
# שמחזיק את אישורי האחסון, וה-API קורא רק את קובץ המצב. כך מסך
# הפלטפורמה מציג "סונכרן לפני X" בלי שסודות ה-R2 ידלפו לאפליקציה.
# ============================================================
set -u

STATE_DIR="${OFFSITE_STATE_DIR:-/state}"
STATE_ENV="${STATE_DIR}/offsite.env"
STATUS_JSON="${STATE_DIR}/status.json"

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

mkdir -p "$STATE_DIR" 2>/dev/null
# שעת ההצלחה האחרונה שורדת ריסטרט — כך "סונכרן לפני X" נשאר נכון
# גם אחרי שהקונטיינר עלה מחדש, ולא מתאפס לכאילו-מעולם-לא-סונכרן.
LAST_SUCCESS_AT=""
# shellcheck disable=SC1090
[ -f "$STATE_ENV" ] && . "$STATE_ENV"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ספירת הקבצים והנפח ביעד — מוצג במסך כאישור שהעותק המרוחק באמת שם.
# כישלון בשאילתה לא מפיל את המחזור; פשוט לא יוצג מספר.
remote_stats() {
  # גרסאות rclone שונות מוסיפות שדות ל-JSON — לכן לא דורשים סוגר אחרי bytes
  rclone size "$dest" --json 2>/dev/null | tr -d ' \n' | \
    sed -n 's/^{"count":\([0-9][0-9]*\),"bytes":\([0-9][0-9]*\).*/\1 \2/p'
}

write_status() {
  state="$1"
  message="$2"
  stats="$(remote_stats)"
  files="${stats%% *}"
  bytes="${stats##* }"
  case "$files" in ''|*[!0-9]*) files=null; bytes=null ;; esac
  case "$bytes" in ''|*[!0-9]*) bytes=null ;; esac

  tmp="${STATUS_JSON}.tmp"
  # כתיבה אטומית: ה-API עלול לקרוא בדיוק באמצע הכתיבה ולקבל JSON קטוע
  cat > "$tmp" <<EOF
{
  "bucket": "${OFFSITE_S3_BUCKET}",
  "state": "${state}",
  "message": "${message}",
  "lastAttemptAt": "$(now_iso)",
  "lastSuccessAt": $([ -n "$LAST_SUCCESS_AT" ] && printf '"%s"' "$LAST_SUCCESS_AT" || printf 'null'),
  "remoteFiles": ${files},
  "remoteBytes": ${bytes}
}
EOF
  mv "$tmp" "$STATUS_JSON"
  printf 'LAST_SUCCESS_AT=%s\n' "$LAST_SUCCESS_AT" > "$STATE_ENV"
}

while true; do
  # ------------------------------------------------------------------
  # הגנה קריטית: rclone sync משקף מחיקות. אם תיקיית הגיבויים המקומית
  # התרוקנה — דיסק שנפל, mount שלא עלה, סקריפט שגוי — הסנכרון הבא היה
  # מוחק גם את העותק המרוחק, כלומר הורס בדיוק את מה שאמור להציל.
  # לכן: אין קבצים מקומיים ⇒ לא נוגעים ביעד.
  # ------------------------------------------------------------------
  # ‎`! -name '.*'`‎ — קובצי הסימון של גיבוי המדיה (‎.media-full-at‎)
  # אינם גיבוי. בלעדיהם ברשימה, „נשארו רק קובצי עזר” נספר כתיקייה
  # ריקה — וזה בדיוק המצב שהבדיקה הזאת נועדה לתפוס.
  count=$(find /backups -type f ! -name '*.tmp' ! -name '.*' 2>/dev/null | head -1 | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "[offsite] ✗ תיקיית הגיבויים המקומית ריקה — הסנכרון דולג כדי לא למחוק את העותק המרוחק" >&2
    write_status "skipped" "תיקיית הגיבויים המקומית ריקה — הסנכרון דולג בכוונה"
  else
    # --backup-dir: קובץ שנמחק או הוחלף עובר לארכיון עם חותמת תאריך
    # במקום להימחק. מחיקה שגויה ניתנת לשחזור.
    if rclone sync /backups "$dest" \
        --exclude "*.tmp" \
        --exclude ".*" \
        --backup-dir "${archive}/$(date +%Y-%m-%d)" \
        --transfers 2 \
        --stats-one-line --stats 0; then
      LAST_SUCCESS_AT="$(now_iso)"
      echo "[offsite] ✓ סונכרן — $(date)"
      write_status "ok" "הסנכרון הושלם"
    else
      echo "[offsite] ✗ הסנכרון נכשל — ניסיון נוסף בעוד 6 שעות" >&2
      write_status "failed" "הסנכרון נכשל — ראו את הלוג של שירות offsite"
    fi
  fi
  sleep 21600
done
