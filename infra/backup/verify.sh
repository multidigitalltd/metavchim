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

# הודעת שגיאה של pg_restore עשויה להכיל גרשיים ולוכסנים; בלי בריחה
# הם שוברים את ה-JSON, והמסך היה מציג "מעולם לא רץ" על תרגיל שנכשל.
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'; }

cleanup() { psql_admin "DROP DATABASE IF EXISTS \"${SCRATCH}\"" > /dev/null 2>&1; }

# ------------------------------------------------------------
# נעילה בין התרגיל המתוזמן לתרגיל לפי דרישה.
#
# המתוזמן רץ בתוך קונטיינר הגיבוי, והידני מגיע מסוכן העדכון —
# שני תהליכים שונים שאינם רואים זה את זה, ושחולקים **מסד בדיקה
# בשם קבוע וקובץ מצב אחד**. בלי נעילה, אחד מוחק את המסד שהשני
# משחזר אליו, ושתי כתיבות המצב מתחרות: התוצאה היא כשל מדומה —
# או גרוע ממנו, ✓ שנכתב על ריצה שנקטעה (ביקורת Codex).
#
# `mkdir` ולא קובץ: הוא אטומי בכל מערכת קבצים POSIX, ואינו דורש
# `flock` שאינו מובטח בתמונת alpine.
# ------------------------------------------------------------
LOCK="${BACKUP_DIR}/.verify.lock"
LOCK_STALE_MINUTES="${VERIFY_LOCK_STALE_MINUTES:-45}"

acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then
    return 0
  fi
  # נעילה שנשארה מתהליך שנהרג (קונטיינר שהופעל מחדש באמצע תרגיל)
  # אינה חוסמת לנצח — אבל הסף ארוך מזמן ריצה סביר, כדי שלא נשחרר
  # נעילה של תרגיל שרק לוקח זמן על מסד גדול.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin "+${LOCK_STALE_MINUTES}" 2>/dev/null)" ]; then
    echo "[verify] נעילה ישנה מ-${LOCK_STALE_MINUTES} דקות — משוחררת" >&2
    rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null && return 0
  fi
  return 1
}

release_lock() { rmdir "$LOCK" 2>/dev/null; }

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
  tables_code=$?
  tenants=$(psql_scratch "SELECT count(*) FROM tenants")
  tenants_code=$?
  cleanup

  elapsed=$((($(date +%s) - start) * 1000))
  tables="${tables:-0}"
  tenants="${tenants:-0}"

  # ------------------------------------------------------------
  # מה נחשב הצלחה — **שלושה תנאים, וכולם חייבים להתקיים.**
  #
  # 1. `pg_restore` הסתיים בלי שגיאה.
  # 2. הסכמה מלאה — לא מסד ריק.
  # 3. שאילתת המשרדים באמת רצה, ולא רק החזירה מחרוזת ריקה.
  #
  # הגרסה הראשונה בדקה רק את (2), מתוך מחשבה שקוד היציאה "רועש
  # מדי". זו הייתה טעות שיוצרת בדיוק את הכשל שהתרגיל נועד למנוע:
  # ארכיון שתוכן העניינים שלו קריא אך רשומת נתונים בתוכו פגומה
  # משאיר סכמה מלאה **ומחזיר קוד שגיאה** — כלומר דיווח ✓ ירוק על
  # גיבוי ששוחזר חלקית (ביקורת Codex).
  #
  # התיקון גם הפוך בכיוונו: תרגיל אדום שגוי עולה בירור, ותרגיל
  # ירוק שגוי עולה את הנתונים. כשיש ספק — נכשלים.
  #
  # `tenants_code` נבדק בנפרד מהערך: `psql` שנכשל מחזיר מחרוזת
  # ריקה, שהופכת ל-0 ועוברת כאילו פשוט אין משרדים.
  # ------------------------------------------------------------
  if [ "$restore_code" -ne 0 ]; then
    detail=$(echo "$restore_log" | grep -i "error" | head -1 | cut -c1-160)
    msg="pg_restore סיים עם שגיאה — ${detail:-ראו את הלוג של שירות הגיבוי}"
    write_state "failed" "\"$name\"" "$tables" "$tenants" "$elapsed" "$(json_escape "$msg")"
    echo "[verify] ✗ ${name}: ${msg}" >&2
    echo "$restore_log" | tail -5 >&2
    return 1
  fi

  if [ "$tables" -lt 10 ]; then
    msg="השחזור הסתיים עם ${tables} טבלאות בלבד — הגיבוי אינו שלם"
    write_state "failed" "\"$name\"" "$tables" "$tenants" "$elapsed" "$(json_escape "$msg")"
    echo "[verify] ✗ ${name}: ${msg}" >&2
    return 1
  fi

  if [ "$tables_code" -ne 0 ] || [ "$tenants_code" -ne 0 ]; then
    msg="המסד המשוחזר אינו נשאל — הסכמה קיימת אך השאילתה נכשלה"
    write_state "failed" "\"$name\"" "$tables" "$tenants" "$elapsed" "$(json_escape "$msg")"
    echo "[verify] ✗ ${name}: ${msg}" >&2
    return 1
  fi

  write_state "ok" "\"$name\"" "$tables" "$tenants" "$elapsed" "שוחזר בהצלחה למסד בדיקה"
  echo "[verify] ✓ ${name}: ${tables} טבלאות, ${tenants} משרדים, ${elapsed}ms"
  return 0
}

if [ "${1:-}" = "once" ] || [ -z "${1:-}" ]; then
  # תרגיל שכבר רץ אינו שגיאה: הבקרה מתקיימת, פשוט לא פעמיים. יציאה
  # ב-0 כדי שלולאת הגיבוי לא תדווח על כשל שלא היה.
  if ! acquire_lock; then
    echo "[verify] תרגיל שחזור כבר רץ — מדלג"
    exit 0
  fi

  # ------------------------------------------------------------
  # ה-trap נרשם **רק אחרי** שהנעילה הושגה, וזה לא פרט טכני.
  #
  # כשהוא נרשם למעלה, התהליך שהפסיד בנעילה יוצא — ו-`cleanup` שלו
  # מוחק את מסד הבדיקה של המנצח, ו-`release_lock` משחרר נעילה שאינה
  # שלו. שתי הריצות נכשלות במקום אחת שמצליחה. התגלה בבדיקת
  # מקביליות אחרי הוספת הנעילה עצמה.
  # ------------------------------------------------------------
  trap 'cleanup; release_lock' EXIT
  verify_once
  exit $?
fi

echo "שימוש: verify.sh once" >&2
exit 64
