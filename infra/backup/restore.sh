#!/bin/sh
# ============================================================
# שחזור מגיבוי — נקרא **רק** מסוכן העדכון (infra/updater), אחרי
# שהוא עצר את api/web/workers כדי שאף אחד לא יכתוב באמצע.
#
#   restore.sh safety-dump              → דאמפ בטיחות לפני שחזור
#   restore.sh db    <file.dump>        → שחזור מסד הנתונים
#   restore.sh media <file.tar.gz>      → שחזור אחסון המדיה
#
# ‎**ארכיון מדיה משלים (‎_diff‎) אינו עומד בפני עצמו.** הוא מחזיק רק
# את מה שהשתנה מאז הארכיון המלא שקדם לו, ולכן השחזור פורס קודם את
# המלא ואז אותו. מי שמבקש לשחזר ממשלים לא צריך לדעת את זה — הסקריפט
# מוצא את המלא בעצמו, ונכשל ברעש אם הוא נמחק.
#
# הפעולה הרסנית מעצם טבעה, ולכן שלוש רשתות ביטחון:
#   1. הסוכן לוקח דאמפ בטיחות לפני כל שחזור — טעות ניתנת לחזרה.
#   2. שחזור המסד רץ בטרנזקציה אחת: כישלון באמצע מחזיר את המצב הקודם
#      במקום להשאיר מסד חצי-משוחזר.
#   3. **כל** ארכיוני השרשרת נבדקים (tar tzf) לפני שמוחקים משהו —
#      ארכיון פגום לא ימחוק את המדיה הקיימת.
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

# הארכיון המלא שארכיון משלים נשען עליו: המלא האחרון שנלקח לפניו.
# מיון לקסיקוגרפי של השם הוא מיון כרונולוגי — חותמת הזמן באורך קבוע.
#
# הלוגיקה משוכפלת ב-packages/shared/src/logic/backup-file.ts (שם היא
# חוסמת מחיקה של מלא שמישהו נשען עליו). השכפול מכוון: הסקריפט הזה
# רץ בקונטיינר בלי Node, ואסור שהשחזור יסתמך על חבילה שצריך לבנות.
media_base_for() {
  target="$1"
  found=""
  for name in $(find /backups -maxdepth 1 -type f -name 'media_*.tar.gz' 2>/dev/null | sed 's|.*/||' | sort); do
    if [ "$name" = "$target" ]; then break; fi
    case "$name" in
      *_diff.tar.gz) ;;
      *) found="$name" ;;
    esac
  done
  echo "$found"
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
    [ -d /minio-data ] || { echo "[restore] ✗ אחסון המדיה אינו מחובר" >&2; exit 2; }

    base=""
    case "$file" in
      *_diff.tar.gz)
        base="$(media_base_for "$file")"
        if [ -z "$base" ]; then
          echo "[restore] ✗ ${file} הוא ארכיון משלים ואין ארכיון מלא שקודם לו — אי אפשר לשחזר ממנו" >&2
          exit 2
        fi
        echo "[restore] ${file} נשען על ${base} — שניהם ייפרסו"
        ;;
    esac

    echo "[restore] בודק את שלמות הארכיונים…"
    if [ -n "$base" ]; then tar tzf "/backups/${base}" > /dev/null; fi
    tar tzf "/backups/${file}" > /dev/null

    echo "[restore] מחליף את תוכן אחסון המדיה…"
    # מוחקים רק את התוכן, לא את נקודת העגינה עצמה
    find /minio-data -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    if [ -n "$base" ]; then
      tar xzf "/backups/${base}" -C /minio-data
      echo "[restore] ✓ הארכיון המלא ${base} נפרס"
    fi
    tar xzf "/backups/${file}" -C /minio-data
    echo "[restore] ✓ אחסון המדיה שוחזר מ-${file}"
    ;;

  *)
    echo "שימוש: restore.sh safety-dump | db <file.dump> | media <file.tar.gz>" >&2
    exit 64
    ;;
esac
