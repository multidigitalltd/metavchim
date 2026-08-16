#!/bin/sh
# ============================================================
# תרגיל שחזור — **ההוכחה שהגיבוי שווה משהו.**
#
# `pg_dump` שהחזיר 0 אומר שהתהליך הסתיים, לא שהקובץ ניתן לשחזור.
# דיסק שהתמלא אחרי הכתיבה, volume שנפגם, ארכיון שנקטע — כולם
# מייצרים קובץ שנראה תקין ברשימה ושנכשל בדיוק כשצריך אותו.
#
# הסקריפט משחזר את הגיבוי האחרון **למסד זמני נפרד**, סופר בו טבלאות
# ומשרדים, ומוחק אותו. התוצאה נכתבת ל-/backups/verify.json ומוצגת
# במסך הפלטפורמה.
#
# זו גם הראיה שמבקר ISO 27001 מבקש לבקרה A.8.13: לא צילום מסך של
# תיקיית הגיבויים, אלא רישום של שחזור שבוצע.
# ============================================================
set -u
umask 077

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-metavchim}"
PGDATABASE="${PGDATABASE:-metavchim}"
# תיקיית הגיבויים ניתנת לדריסה — כך אפשר להריץ את התרגיל מול
# תיקייה זמנית בבדיקה בלי לגעת בגיבויים האמיתיים.
BACKUP_DIR="${BACKUP_DIR:-/backups}"
STATE="${BACKUP_DIR}/verify.json"

# ------------------------------------------------------------
# שם המסד הזמני. **בלם בטיחות מוחלט:** הסקריפט מוחק את המסד הזה
# בהתחלה ובסוף, ולכן הוא מסרב לרוץ אם השם נגזר איכשהו לשם המסד
# האמיתי. תרגיל שמוחק את הפרודקשן הוא בדיוק ההפך ממה שהוא נועד לו.
# ------------------------------------------------------------
SCRATCH="${VERIFY_DB_NAME:-metavchim_restore_check}"
if [ "$SCRATCH" = "$PGDATABASE" ]; then
  echo "[verify] ✗ שם מסד הבדיקה זהה למסד האמיתי — עצירה" >&2
  exit 3
fi

psql_scratch() { psql -h "$PGHOST" -U "$PGUSER" -d "$SCRATCH" -tA -c "$1" 2>/dev/null; }
psql_admin() { psql -h "$PGHOST" -U "$PGUSER" -d postgres -q -c "$1" 2>/dev/null; }

# JSON נכתב בהחלפה אטומית: קורא שתופס את הקובץ באמצע כתיבה יקבל
# JSON פגום, וזה מצב שנראה כמו כשל בלי שקרה כשל.
write_state() {
  cat > "${STATE}.tmp" <<EOF
{
  "state": "$1",
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": $2,
  "tables": $3,
  "tenants": $4,
  "durationMs": $5,
  "message": "$6"
}
EOF
  mv "${STATE}.tmp" "$STATE"
}

cleanup() { psql_admin "DROP DATABASE IF EXISTS \"${SCRATCH}\"" > /dev/null 2>&1; }

verify_once() {
  start=$(date +%s)

  latest=$(ls -1t "${BACKUP_DIR}"/db_*.dump 2>/dev/null | head -1)
  if [ -z "${latest:-}" ]; then
    write_state "failed" "null" "null" "null" "null" "אין קובץ גיבוי לבדוק"
    echo "[verify] ✗ אין גיבוי לבדוק" >&2
    return 1
  fi
  name=$(basename "$latest")

  # שלב 1 — תוכן העניינים של הארכיון. זול, ותופס קובץ קטוע או פגום
  # בלי לגעת במסד בכלל.
  if ! pg_restore --list "$latest" > /dev/null 2>&1; then
    write_state "failed" "\"$name\"" "null" "null" "null" "הארכיון אינו קריא — pg_restore --list נכשל"
    echo "[verify] ✗ ${name}: הארכיון אינו קריא" >&2
    return 1
  fi

  # שלב 2 — שחזור אמיתי למסד נקי.
  cleanup
  if ! psql_admin "CREATE DATABASE \"${SCRATCH}\""; then
    write_state "failed" "\"$name\"" "null" "null" "null" "יצירת מסד הבדיקה נכשלה"
    echo "[verify] ✗ יצירת מסד הבדיקה נכשלה" >&2
    return 1
  fi

  # --no-owner/--no-privileges: התרגיל בודק שהנתונים והמבנה שרדו,
  # ולא את מפת התפקידים — היא נבדקת ממילא בשחזור אמיתי, שרץ אל תוך
  # מסד עם אותם תפקידים. בלעדיהם התרגיל היה נכשל על הרשאות ומדווח
  # על גיבוי תקין ככשל.
  restore_log=$(pg_restore -h "$PGHOST" -U "$PGUSER" -d "$SCRATCH" \
    --no-owner --no-privileges --no-password "$latest" 2>&1)
  restore_code=$?

  tables=$(psql_scratch "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  tenants=$(psql_scratch "SELECT count(*) FROM tenants")
  cleanup

  elapsed=$((($(date +%s) - start) * 1000))
  tables="${tables:-0}"
  tenants="${tenants:-0}"

  # ------------------------------------------------------------
  # מה נחשב הצלחה.
  #
  # קוד היציאה של pg_restore לבדו אינו מספיק: הוא מחזיר שגיאה גם על
  # אזהרות שוליות, ומחזיר 0 על שחזור שיצר סכמה ריקה. לכן הקריטריון
  # הוא **מה שנמצא במסד אחרי השחזור** — טבלאות קיימות, וטבלת
  # המשרדים נקראת. מסד ששוחזר ריק הוא כשל, גם אם כל הפקודות עברו.
  # ------------------------------------------------------------
  if [ "$tables" -lt 10 ]; then
    msg="השחזור הסתיים עם ${tables} טבלאות בלבד — הגיבוי אינו שלם"
    write_state "failed" "\"$name\"" "$tables" "$tenants" "$elapsed" "$msg"
    echo "[verify] ✗ ${name}: ${msg}" >&2
    [ "$restore_code" -ne 0 ] && echo "$restore_log" | tail -5 >&2
    return 1
  fi

  write_state "ok" "\"$name\"" "$tables" "$tenants" "$elapsed" "שוחזר בהצלחה למסד בדיקה"
  echo "[verify] ✓ ${name}: ${tables} טבלאות, ${tenants} משרדים, ${elapsed}ms"
  return 0
}

trap cleanup EXIT

if [ "${1:-}" = "once" ] || [ -z "${1:-}" ]; then
  verify_once
  exit $?
fi

echo "שימוש: verify.sh once" >&2
exit 64
