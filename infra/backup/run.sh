#!/bin/sh
# ============================================================
# שירות הגיבוי — רץ כקונטיינר צד לצד עם ה-DB (docs/10-deployment.md).
#
# כל 24 שעות: pg_dump בפורמט custom (דחוס, מתאים ל-pg_restore) אל
# תיקיית הגיבויים שממופה למארח, עם ניקוי גיבויים ישנים. פעם בשבוע
# (יום ראשון) נארז גם אחסון התמונות (MinIO) כ-tar.gz.
#
# הגיבוי הראשון רץ מיד בעליית הקונטיינר — כך תמיד יש גיבוי טרי
# אחרי התקנה או עדכון, וקל לוודא שהמנגנון עובד.
# ============================================================
set -u

# הגיבויים מכילים את כל נתוני הלקוחות — קבצים נקראים לבעלים בלבד (0600)
umask 077

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MEDIA_KEEP_DAYS="${BACKUP_MEDIA_KEEP_DAYS:-28}"

backup_once() {
  stamp="$(date +%Y-%m-%d_%H%M)"

  # --- מסד הנתונים ---
  tmp="/backups/db_${stamp}.dump.tmp"
  out="/backups/db_${stamp}.dump"
  if pg_dump -h postgres -U metavchim -d metavchim -Fc -f "$tmp"; then
    mv "$tmp" "$out"
    echo "[backup] ✓ DB → ${out} ($(du -h "$out" | cut -f1))"
  else
    rm -f "$tmp"
    echo "[backup] ✗ pg_dump נכשל" >&2
  fi

  # --- תמונות (MinIO) — פעם בשבוע, ביום ראשון ---
  # tar על volume חי: העלאה שרצה בדיוק ברגע הגיבוי עלולה להיתפס חלקית
  # (חלון קטן — הריצה בשעת לילה). האימות עם tar tzf תופס ארכיון קטוע/פגום;
  # לגיבוי עקבי-לחלוטין עוצרים רגעית את minio ומגבים ידנית (docs/10).
  if [ "$(date +%u)" = "7" ] && [ -d /minio-data ]; then
    mtmp="/backups/media_${stamp}.tar.gz.tmp"
    mout="/backups/media_${stamp}.tar.gz"
    if tar czf "$mtmp" -C /minio-data . && tar tzf "$mtmp" > /dev/null; then
      mv "$mtmp" "$mout"
      echo "[backup] ✓ מדיה → ${mout} ($(du -h "$mout" | cut -f1))"
    else
      rm -f "$mtmp"
      echo "[backup] ✗ גיבוי המדיה נכשל" >&2
    fi
  fi

  # --- תרגיל שחזור — פעם בשבוע, ביום שני ---
  #
  # יום אחרי ארכיון המדיה ולא באותו יום: שני התהליכים כבדים, והרצתם
  # יחד הופכת לילה אחד בשבוע ללילה שבו המסד עמוס פי שניים. התרגיל
  # משחזר את הגיבוי האחרון למסד זמני ומוחק אותו — ראו verify.sh.
  if [ "$(date +%u)" = "1" ] && [ -x /backup/verify.sh ]; then
    /backup/verify.sh once || echo "[backup] ✗ תרגיל השחזור נכשל — ראו את verify.json" >&2
  fi

  # --- ניקוי ישנים ---
  find /backups -name 'db_*.dump' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null
  find /backups -name 'media_*.tar.gz' -mtime "+${MEDIA_KEEP_DAYS}" -delete 2>/dev/null
  find /backups -name '*.tmp' -mmin +120 -delete 2>/dev/null
}

# הרצה חד-פעמית: `run.sh once` מבצע גיבוי ויוצא.
#
# זה מה שמפעיל כפתור "גבה עכשיו" במסך הפלטפורמה, דרך סוכן העדכון.
# אותו backup_once בדיוק — כדי שגיבוי ידני וגיבוי מתוזמן ייצרו את
# אותו קובץ באותו פורמט, ושחזור לא יצטרך להבחין ביניהם.
if [ "${1:-}" = "once" ]; then
  echo "[backup] גיבוי ידני מתחיל"
  backup_once
  echo "[backup] גיבוי ידני הסתיים"
  exit 0
fi

# `run.sh verify` — תרגיל שחזור לבד, בלי לגבות. זה מה שמפעיל כפתור
# "בדוק שחזור" במסך הפלטפורמה: מבקר שמבקש ראיה לבקרה A.8.13 אמור
# לקבל אותה בלחיצה, ולא להמתין ליום שני.
if [ "${1:-}" = "verify" ]; then
  exec /backup/verify.sh once
fi

echo "[backup] שירות הגיבוי עלה — גיבוי DB כל 24 שעות, מדיה בימי ראשון, תרגיל שחזור בימי שני, שמירה ${KEEP_DAYS} ימים"
while true; do
  backup_once
  sleep 86400
done
