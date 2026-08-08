#!/bin/sh
# ============================================================
# שחזור מגיבוי — נקרא **רק** מסוכן העדכון (infra/updater), אחרי
# שהוא עצר את api/web/workers כדי שאף אחד לא יכתוב באמצע.
#
#   restore.sh safety-dump              → דאמפ בטיחות לפני שחזור
#   restore.sh db    <file.dump>        → שחזור מסד הנתונים
#   restore.sh media <file.tar.gz>      → שחזור אחסון התמונות
#
# הפעולה הרסנית מעצם טבעה, ולכן שלוש רשתות ביטחון:
#   1. הסוכן לוקח דאמפ בטיחות לפני כל שחזור — טעות ניתנת לחזרה.
#   2. שחזור המסד רץ בטרנזקציה אחת: כישלון באמצע מחזיר את המצב הקודם
#      במקום להשאיר מסד חצי-משוחזר.
#   3. ארכיון התמונות נבדק (tar tzf) לפני שמוחקים משהו — ארכיון פגום
#      לא ימחוק את התמונות הקיימות.
# ============================================================
set -eu

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-metavchim}"
PGDATABASE="${PGDATABASE:-metavchim}"

# רשימת היתר זהה ל-packages/shared/src/logic/backup-file.ts — הגנה
# בעומק: גם אם ולידציית ה-API תעקף, שם קובץ זר ייעצר כאן.
valid_name() {
  echo "$1" | grep -Eq '^db_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}(_[a-z][a-z-]{0,23})?\.dump$' && return 0
  echo "$1" | grep -Eq '^media_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}(_[a-z][a-z-]{0,23})?\.tar\.gz$' && return 0
  return 1
}

mode="${1:-}"

case "$mode" in
  safety-dump)
    out="/backups/db_$(date +%Y-%m-%d_%H%M)_pre-restore.dump"
    umask 077
    pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "${out}.tmp"
    mv "${out}.tmp" "$out"
    echo "[restore] ✓ דאמפ בטיחות נשמר: ${out}"
    ;;

  db)
    file="${2:-}"
    valid_name "$file" || { echo "[restore] ✗ שם קובץ לא חוקי" >&2; exit 2; }
    [ -f "/backups/${file}" ] || { echo "[restore] ✗ הקובץ לא נמצא: ${file}" >&2; exit 2; }

    echo "[restore] משחזר את מסד הנתונים מ-${file}…"
    # --single-transaction: הכול או כלום. --clean --if-exists מוחק את
    # האובייקטים הקיימים לפני היצירה מחדש, כך שהמסד חוזר בדיוק למצב
    # שבגיבוי ולא למיזוג של שניהם.
    pg_restore -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
      --clean --if-exists --single-transaction --no-password \
      "/backups/${file}"
    echo "[restore] ✓ מסד הנתונים שוחזר מ-${file}"
    ;;

  media)
    file="${2:-}"
    valid_name "$file" || { echo "[restore] ✗ שם קובץ לא חוקי" >&2; exit 2; }
    [ -f "/backups/${file}" ] || { echo "[restore] ✗ הקובץ לא נמצא: ${file}" >&2; exit 2; }
    [ -d /minio-data ] || { echo "[restore] ✗ אחסון התמונות אינו מחובר" >&2; exit 2; }

    echo "[restore] בודק את שלמות הארכיון…"
    tar tzf "/backups/${file}" > /dev/null

    echo "[restore] מחליף את תוכן אחסון התמונות…"
    # מוחקים רק את התוכן, לא את נקודת העגינה עצמה
    find /minio-data -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar xzf "/backups/${file}" -C /minio-data
    echo "[restore] ✓ אחסון התמונות שוחזר מ-${file}"
    ;;

  *)
    echo "שימוש: restore.sh safety-dump | db <file.dump> | media <file.tar.gz>" >&2
    exit 64
    ;;
esac
