# Data safety — התשובות לטופס ב-Play Console

מה שהאפליקציה **בפועל** אוספת ושולחת, לפי הקוד (`apps/mobile/src/lib`,
`apps/api`), ולא לפי מה שנשמע בטוח. שינוי באפליקציה שנוגע באחד מהפריטים
מחייב עדכון כאן ובטופס. הטופס: Policy → App content → Data safety.

## שאלות הפתיחה

| שאלה | תשובה | למה |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | פרטי משתמש ולקוחות נשלחים לשרת |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS בלבד (`apiBase()` מ-`EXPO_PUBLIC_API_URL`) |
| Do you provide a way for users to request that their data is deleted? | **Yes** | בעל המשרד: הגדרות → מחיקת החשבון (`POST /settings/delete-account`); סוכן: מנהל המשרד מסיר אותו. מדיניות: https://app.metavchim.co.il/privacy (סעיף „מחיקת המידע שלכם”) |

## סוגי הנתונים

„Collected” = נשלח מהמכשיר לשרת. „Shared” = מועבר לצד שלישי מחוץ לספקי
העיבוד שלנו (לא: ספק אירוח ותמלול הם Service providers ואינם „שיתוף” לפי
הגדרות גוגל). „Ephemeral” = מעובד בזיכרון בלבד ואינו נשמר.

| קטגוריה | סוג | Collected | Shared | Required | Purpose | הערות |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info | Name | ✔ | ✘ | ✔ | App functionality, Account management | שם המשתמש (סוכן) ושמות הלקוחות שהוא מזין |
| Personal info | Email address | ✔ | ✘ | ✔ | App functionality, Account management | התחברות; אימייל של לקוחות כשמוזן |
| Personal info | Phone number | ✔ | ✘ | ✔ | App functionality | טלפונים של לקוחות ולידים (המשרד הוא בעל המאגר) |
| Personal info | Address | ✔ | ✘ | ✘ | App functionality | כתובות נכסים |
| Messages | Other in-app messages | ✔ | ✘ | ✘ | App functionality | הערות, סיכומי שיחות, הצעות שנשלחו |
| Audio | Voice or sound recordings | ✔ | ✘ | ✘ | App functionality | הסוכן הקולי (נמחק אחרי התמלול) והקלטת פגישה (נשמרת בכרטיס) — רק בלחיצה על „הקלטה” |
| Photos and videos | Photos | ✔ | ✘ | ✘ | App functionality | תמונות נכס שהמשתמש מעלה מהגלריה (בכרטיס הנכס המוטמע), ותמונות שמצורפות למייל בתיבה המוטמעת |
| Photos and videos | Videos | ✔ | ✘ | ✘ | App functionality | סרטונים (MP4/MOV/WebM) שהמשתמש מצרף למייל בתיבת המייל המוטמעת (`/inbox`) — רק כשמצרפים |
| App activity | App interactions | ✘ | ✘ | — | — | אין אנליטיקה; אין SDK צד שלישי |
| App info and performance | Crash logs | ✘ | ✘ | — | — | אין Crashlytics/Sentry |
| Device or other IDs | Device or other IDs | ✔ | ✘ | ✘ | App functionality | טוקן הפוש של Expo + דגם המכשיר (`POST /notifications/push/device`) — רק אחרי הפעלת התראות |
| Location | Approximate / Precise | ✘ | ✘ | — | — | אין הרשאת מיקום |
| Contacts | Contacts | ✘ | ✘ | — | — | אין גישה לאנשי הקשר של המכשיר; חיוג/וואטסאפ פותחים אפליקציה חיצונית |
| Financial info | — | ✘ | ✘ | — | — | אין תשלומים באפליקציה |
| Health and fitness | — | ✘ | ✘ | — | — | |
| Calendar | Calendar events | ✔ | ✘ | ✘ | App functionality | פגישות וסיורים שהמשתמש קובע במערכת (סוג, מועד, משך, כותרת, הערות, קישור ללקוח ולנכס — `POST /appointments`). אין קריאה או כתיבה ליומן של **המכשיר** |
| Files and docs | Files and docs | ✔ | ✘ | ✘ | App functionality | מסמכים שמועלים לכרטיס נכס (מוטמע) |
| Web browsing | — | ✘ | ✘ | — | — | ה-WebView מציג רק את app.metavchim.co.il |

## מה נשמר במכשיר (לא נשאל בטופס, אבל נשאל בביקורת)

- טוקן ה-Session — ב-Keystore/Keychain (`expo-secure-store`).
- טוקן הפוש — Keystore.
- מטמון לא-מקוון של הרשימות האחרונות (AsyncStorage), במרחב לפי משתמש; נמחק בכל יציאה — התנתקות, החלפת סיסמה, וגם Session שפג או נותק ממכשיר אחר (`clearLastCacheScope`).
- בחירת ערכת נושא, מתג נעילת האפליקציה, ו„עד לאן הוצגו התראות” (חותמת זמן) לסריקת הרקע.

## הרשאות Android (Policy → App content → Permissions declaration)

| הרשאה | למה | הצהרה מיוחדת? |
| --- | --- | --- |
| RECORD_AUDIO | הסוכן הקולי והקלטת פגישה, רק בלחיצה | לא (לא „רגישה” לפי גוגל, אבל תמיד עם הסבר בשימוש הראשון) |
| POST_NOTIFICATIONS (Android 13+) | התראות פוש | לא |
| USE_BIOMETRIC / USE_FINGERPRINT | בדיקה **האם** המכשיר נעול (קובע כמה זמן נשארים מחוברים), ואימות של מערכת ההפעלה כש„נעילת האפליקציה” מופעלת. הנתונים הביומטריים נשארים במערכת; האפליקציה מקבלת רק „הצליח / לא” | לא |
| INTERNET, VIBRATE, FOREGROUND_SERVICE(_MEDIA_PLAYBACK), MODIFY_AUDIO_SETTINGS | רשת, רטט התראה, ניגון הקלטה ברקע (expo-audio) | לא |
| READ/WRITE_EXTERNAL_STORAGE (עד API 32) | תבנית Expo; בחירת תמונה עוברת דרך בורר המערכת | לא |
| RECEIVE_BOOT_COMPLETED / WAKE_LOCK (WorkManager) | סריקת ההתראות ברקע כשאין פוש (`expo-background-task`) | לא |

`SYSTEM_ALERT_WINDOW` (תפריט הפיתוח של React Native) חסום ב-`app.json`
(`android.blockedPermissions`) — אין לו מקום בבניית חנות.
