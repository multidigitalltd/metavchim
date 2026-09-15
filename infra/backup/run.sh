#!/bin/sh
# ============================================================
# שירות הגיבוי — רץ כקונטיינר צד לצד עם ה-DB (docs/10-deployment.md).
#
# כל 24 שעות: pg_dump בפורמט custom (דחוס, מתאים ל-pg_restore) **וגם**
# ארכיון של אחסון המדיה (MinIO), אל תיקיית הגיבויים שממופה למארח,
# עם ניקוי גיבויים ישנים.
#
# ‎**המדיה מגובה כל יום, אבל לא מארכבים אותה מחדש כל יום.** מה שיושב
# שם אינו „תמונות”: הקלטות שיחה, צירופי פניות וחתימות על מסמכים —
# נתונים שאין להם מקור אחר לשחזור מתוכם. גיבוי שבועי פירושו שעד שישה
# ימי הקלטות וחתימות אינם מגובים בשום מקום. אבל ארכיון מלא בכל יום,
# שנשמר 30 יום, הוא 30 עותקים כמעט זהים של אותה מדיה — ומה שמילא את
# הדיסק הוא לא הנתונים אלא הגיבוי שלהם.
#
# לכן שתי דרגות:
#   media_<חותמת>_full.tar.gz  — כל האחסון. אחת ל-BACKUP_MEDIA_FULL_DAYS.
#   media_<חותמת>_diff.tar.gz  — רק מה שהשתנה **מאז אותו מלא**, כל יום.
#
# ‎`diff`‎ הוא הפרשי ולא מצטבר, בכוונה: שחזור דורש בדיוק שני קבצים —
# המלא ואחד משלים — ולא שרשרת שבה קובץ פגום אחד באמצע מאבד את כל מה
# שבא אחריו. זה גם מה שמאפשר למחוק ארכיון משלים בודד בלי לשבור דבר.
#
# הגיבוי הראשון רץ מיד בעליית הקונטיינר — כך תמיד יש גיבוי טרי
# אחרי התקנה או עדכון, וקל לוודא שהמנגנון עובד.
# ============================================================
set -u

# הגיבויים מכילים את כל נתוני הלקוחות — קבצים נקראים לבעלים בלבד (0600)
umask 077

KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
MEDIA_KEEP_DAYS="${BACKUP_MEDIA_KEEP_DAYS:-30}"

# כל כמה ימים נסרק כל האחסון מחדש. ככל שהמספר גדול יותר כך הגיבוי
# זול יותר בדיסק, אבל הארכיון המשלים תופח (הוא מחזיק את כל השינויים
# מאז המלא) והשחזור חוזר רחוק יותר אחורה. שבוע הוא האיזון.
MEDIA_FULL_DAYS="${BACKUP_MEDIA_FULL_DAYS:-7}"

# ‎**מרווח ביטחון על הדיסק — לפני כתיבת ארכיון המדיה.**
#
# אם המדיה תופחת, הגיבוי הוא מה שימלא את הדיסק — ודיסק מלא מפיל את
# המערכת כולה, לא רק את הגיבוי. גיבוי שהורג את הייצור גרוע מגיבוי
# שדילג על יום אחד וצעק על כך ביומן.
#
# ‎**המרווח נבדק מעל גודל הארכיון, לא במקומו.** סף קבוע לבדו אינו
# שומר על כלום: 3GB פנויים עוברים סף של 2GB, ואז ארכיון של 5GB ממלא
# את הדיסק עד הסוף בדיוק כפי שהסף נועד למנוע. לכן נמדד מראש מה
# עומדים לארכב, ונדרש מקום לזה **ועוד** המרווח.
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"

# מתי נלקח הארכיון המלא האחרון, ומי הוא. זמן השינוי של הקובץ הזה הוא
# קו הגבול של `find -newer` עבור הארכיון המשלים; תוכנו הוא שם הקובץ
# שהמשלים נשען עליו.
MEDIA_MARK="/backups/.media-full-at"

# שמות ארכיוני המדיה לפי סדר כרונולוגי. חותמת הזמן בשם היא באורך
# קבוע, ולכן מיון לקסיקוגרפי של השם **הוא** מיון לפי זמן — ואין צורך
# להסתמך על זמן השינוי, שמשתנה בהעתקה של הקבצים.
media_names() {
  find /backups -maxdepth 1 -type f -name 'media_*.tar.gz' 2>/dev/null | sed 's|.*/||' | sort
}

is_media_diff() {
  case "$1" in
    *_diff.tar.gz) return 0 ;;
    *) return 1 ;;
  esac
}

# ניקוי ארכיוני המדיה — ‎**בלי לשבור שרשרת.**
#
# משלים שפג תוקפו נמחק תמיד; אף אחד לא נשען עליו. מלא נמחק רק אם אף
# משלים ששרד אינו נשען עליו, ולעולם לא האחרון. בלי הבדיקה הזאת ניקוי
# לפי גיל בלבד היה מוחק את המלא ומשאיר עשרה משלימים חסרי תועלת.
prune_media() {
  find /backups -maxdepth 1 -type f -name 'media_*_diff.tar.gz' \
    -mtime "+${MEDIA_KEEP_DAYS}" -delete 2>/dev/null

  needed=""
  current=""
  for name in $(media_names); do
    if is_media_diff "$name"; then
      [ -n "$current" ] && needed="${needed} ${current}"
    else
      current="$name"
    fi
  done
  newest_full="$current"

  for path in $(find /backups -maxdepth 1 -type f -name 'media_*.tar.gz' \
                  -mtime "+${MEDIA_KEEP_DAYS}" 2>/dev/null); do
    name="${path##*/}"
    is_media_diff "$name" && continue
    [ "$name" = "$newest_full" ] && continue
    case " ${needed} " in
      *" ${name} "*) continue ;;
    esac
    rm -f "$path"
  done
}

# רשימת הקבצים שהארכיון המשלים יכיל — נבנית פעם אחת ומשמשת גם
# למדידה וגם ל-tar עצמו.
MEDIA_LIST="/backups/.media-diff-list.tmp"

# כמה מקום צריך לארכיון של הדרגה הזאת, ב-MB.
#
# הגודל הגולמי הוא **חסם עליון** על הארכיון הדחוס — gzip לא מגדיל —
# ולכן די בו כדי להבטיח שהכתיבה לא תיגע במרווח. `du` על עץ המדיה
# עולה מעבר אחד, זניח מול ה-tar שבא אחריו.
media_need_mb() {
  tier="$1"
  if [ "$tier" = "full" ]; then
    raw_kb="$(du -sk /minio-data 2>/dev/null | awk '{print $1+0}')"
  else
    ( cd /minio-data && find . -newer "$MEDIA_MARK" \( -type f -o -type l \) -print ) \
      > "$MEDIA_LIST" 2>/dev/null
    if [ -s "$MEDIA_LIST" ]; then
      # ‎`tr` ל-NUL ו-`xargs -0`: שם קובץ עם רווח אינו מקרה קצה
      # תיאורטי באחסון אובייקטים, והוא היה מפצל את הספירה.
      raw_kb="$(cd /minio-data && tr '\n' '\0' < "$MEDIA_LIST" |
        xargs -0 du -k 2>/dev/null | awk '{s+=$1} END {print s+0}')"
    else
      raw_kb=0
    fi
  fi
  case "$raw_kb" in ''|*[!0-9]*) raw_kb=0 ;; esac
  echo $(( raw_kb / 1024 + 1 + MIN_FREE_MB ))
}

# ארכיון המדיה של היום — מלא או משלים, לפי גיל המלא האחרון.
#
# tar על volume חי: העלאה שרצה בדיוק ברגע הגיבוי עלולה להיתפס חלקית
# (חלון קטן — הריצה בשעת לילה). האימות עם tar tzf תופס ארכיון קטוע;
# לגיבוי עקבי-לחלוטין עוצרים רגעית את minio ומגבים ידנית (docs/10).
backup_media() {
  stamp="$1"
  [ -d /minio-data ] || return 0

  # ‎**מתי מותר להסתפק במשלים.** שלושה תנאים, וכולם נדרשים: הסימון
  # קיים ותקין, הארכיון המלא שהוא מצביע עליו עדיין על הדיסק (אפשר
  # למחוק אותו מהממשק), והוא צעיר מספיק. כל כישלון ⟵ ארכיון מלא.
  base="$(cat "$MEDIA_MARK" 2>/dev/null)"
  echo "$base" | grep -Eq '^media_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}_full\.tar\.gz$' || base=""
  [ -n "$base" ] && [ -f "/backups/${base}" ] || base=""
  if [ -n "$base" ] && [ -n "$(find "$MEDIA_MARK" -mtime "-${MEDIA_FULL_DAYS}" 2>/dev/null)" ]; then
    tier="diff"
    label="משלים, מאז ${base}"
  else
    tier="full"
    label="מלא"
  fi

  free_mb="$(df -Pm /backups 2>/dev/null | awk 'NR==2 {print $4}')"
  case "$free_mb" in ''|*[!0-9]*) free_mb=0 ;; esac
  need_mb="$(media_need_mb "$tier")"

  # ‎**כשהמלא אינו נכנס, לוקחים משלים במקומו.**
  #
  # דילוג גורר את עצמו: הסימון אינו מתקדם, מחר שוב ייבחר „מלא”, ושוב
  # ייחסם — וכך אין שום גיבוי מדיה עד שיתפנה מקום. משלים על גבי המלא
  # הישן קטן בהרבה, ומחזיק את ההקלטות והחתימות של היום.
  if [ "$tier" = "full" ] && [ "$free_mb" -lt "$need_mb" ] && [ -n "$base" ]; then
    echo "[backup] ! הארכיון המלא נדחה — ${free_mb}MB פנויים מול ${need_mb}MB דרושים; נלקח משלים במקומו" >&2
    tier="diff"
    label="משלים, מאז ${base} — המלא נדחה מחוסר מקום"
    need_mb="$(media_need_mb "$tier")"
  fi

  if [ "$free_mb" -lt "$need_mb" ]; then
    # לא כותבים ולא מוחקים — רק צועקים. המקום הפנוי הוא בעיה
    # תפעולית, והשתקתה בכתיבה חלקית הופכת אותה לתקלת ייצור.
    rm -f "$MEDIA_LIST"
    echo "[backup] ✗ אין מספיק מקום לארכיון המדיה (${free_mb}MB פנויים, נדרשים ${need_mb}MB — הארכיון ועוד ${MIN_FREE_MB}MB מרווח) — דולג" >&2
    return 0
  fi

  mtmp="/backups/media_${stamp}_${tier}.tar.gz.tmp"
  mout="/backups/media_${stamp}_${tier}.tar.gz"
  mark_tmp="${MEDIA_MARK}.tmp"
  empty_dir="/tmp/media-empty"
  ok=0

  if [ "$tier" = "full" ]; then
    # הסימון נכתב **לפני** ה-tar ומועבר למקומו רק בהצלחה: זמן השינוי
    # שלו חייב להיות רגע ההתחלה, אחרת קובץ שנוצר תוך כדי הסריקה לא
    # ייכנס לא לארכיון הזה ולא למשלים שאחריו.
    printf '%s\n' "media_${stamp}_full.tar.gz" > "$mark_tmp"
    tar czf "$mtmp" -C /minio-data . && tar tzf "$mtmp" > /dev/null && ok=1
  elif [ -s "$MEDIA_LIST" ]; then
    tar czf "$mtmp" -C /minio-data -T "$MEDIA_LIST" && tar tzf "$mtmp" > /dev/null && ok=1
  else
    # יום בלי שינוי במדיה עדיין מקבל ארכיון — ריק, כמה עשרות בתים.
    # ארכיון חסר נראה בדיוק כמו מנגנון שנפל, וזה ההבדל שאסור לטשטש:
    # מסך הגיבויים מזהיר על מדיה שלא גובתה 48 שעות.
    mkdir -p "$empty_dir" &&
      tar czf "$mtmp" -C "$empty_dir" . && tar tzf "$mtmp" > /dev/null && ok=1
  fi
  rm -f "$MEDIA_LIST"

  if [ "$ok" = 1 ]; then
    mv "$mtmp" "$mout"
    [ "$tier" = "full" ] && mv "$mark_tmp" "$MEDIA_MARK"
    echo "[backup] ✓ מדיה (${label}) → ${mout} ($(du -h "$mout" | cut -f1))"
  else
    rm -f "$mtmp" "$mark_tmp"
    echo "[backup] ✗ גיבוי המדיה נכשל" >&2
  fi
}

backup_once() {
  stamp="$(date +%Y-%m-%d_%H%M)"

  # ‎**הניקוי לפני הכתיבה ולא אחריו.**
  #
  # כשנשמרים 30 עותקים, המקום לארכיון של היום מגיע מזה שפג היום.
  # ניקוי בסוף פירושו שיא רגעי של 31 עותקים — ובדיוק הרגע הזה הוא
  # שממלא דיסק שכמעט מלא.
  find /backups -name 'db_*.dump' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null
  find /backups -name '*.tmp' -mmin +120 -delete 2>/dev/null
  prune_media

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

  # --- מדיה (MinIO) ---
  backup_media "$stamp"

  # --- תרגיל שחזור — פעם בשבוע, ביום שני ---
  #
  # התרגיל משחזר את הגיבוי האחרון למסד זמני ומוחק אותו — ראו verify.sh.
  if [ "$(date +%u)" = "1" ] && [ -x /backup/verify.sh ]; then
    /backup/verify.sh once || echo "[backup] ✗ תרגיל השחזור נכשל — ראו את verify.json" >&2
  fi

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

echo "[backup] שירות הגיבוי עלה — DB ומדיה כל 24 שעות (מדיה: מלא כל ${MEDIA_FULL_DAYS} ימים, משלים בין לבין), תרגיל שחזור בימי שני, שמירה ${KEEP_DAYS}/${MEDIA_KEEP_DAYS} ימים"
while true; do
  backup_once
  sleep 86400
done
