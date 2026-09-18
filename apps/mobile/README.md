# @metavchim/mobile — האפליקציה לנייד

Expo (React Native) בתוך המונוריפו. צרכן של אותו API כמו ה-web, עם אותה חבילת
`@metavchim/shared`. ההחלטה, ההיקף ומה שעוד לא נבנה — [ADR-007](../../docs/adr/ADR-007-native-mobile-app.md).

## מה יש

| מסך | מה עושים |
|-----|----------|
| התחברות · שכחתי סיסמה · החלפת סיסמה | אימייל+סיסמה, קוד אימייל כשמופעל, **התחברות עם Google** כשמוגדרת בשרת, קישור לאיפוס במייל; סיסמה זמנית חייבת להתחלף לפני הכול |
| היום | לידים שממתינים (מהשרת, הוותיק ראשון), הפגישות של היום, המשימות שלי עם „בוצע” |
| לידים · ליד חדש · ליד | סינון במסד, חיפוש; קליטה מהירה; חיוג, וואטסאפ, סטטוס, ציר זמן, הערה, משימה |
| קול | הסוכן האישי: הקלטה → תמלול → הצעה לאישור → ביצוע; או הקלדה |
| נכסים · נכס | פרטים, מוכנות ומה חסר, בעל הנכס, לקוחות מתאימים, משימה |
| לקוחות · לקוח | דרישות ומימון, נכסים מתאימים, משימה |
| משימות · משימה חדשה | הדליים של לוח המשימות (באיחור, היום, השבוע…), שלי / כל המשרד, פתוחות / בוצעו, „בוצע” בלחיצה; מועד מהיר בשעון ישראל, עדיפות, קישור לישות |
| יומן | לפי ימים עם התאריך העברי; השבוע / השבוע הבא / לתיעוד (סיורים שהתקיימו בלי תוצאה); „התקיימה”, ביטול; פגישה חדשה ועריכה — במסך הפגישה של המערכת |
| התאמות | לפי נכס ← קונים או לפי קונה ← נכסים, סף התאמה, ציון והסבר, „לא רלוונטי” עם סיבה, הצעה בוואטסאפ; `?property=` מכרטיס הנכס |
| התראות · Push | רשימה, סימון כנקרא; התראות פוש למכשיר (Expo) עם ניווט לישות |
| האפליקציה | מי מחובר, הפרופיל (במערכת), **ערכת נושא** (בהיר / כהה / אוטומטי), התראות הפוש, התנתקות, גרסה |
| **כל שאר המערכת** | דשבורד (מסך הבית), שיחות, הצעות, תיבת מייל, שת"פים, דוחות, פורום, המנטור, ניהול משרד, הקמה, פלטפורמה — **ה-web עצמו, מוטמע** באפליקציה (ראו „איך זה מתחבר”) |

**המעטפת היא של ה-web במובייל**: שורת כותרת לבנה עם כפתור תפריט, כותרת המסך, פעמון
והסוכן הקולי; ומגירה כהה עם אותם פריטי ניווט, אותו סדר, אותם מונים ותגים ואותם כללי
הרשאה/מסלול כמו הסרגל ב-web (`src/lib/nav.ts`). הגופן הוא Almoni, הלוגו הוא לוגו
המערכת, והטוקנים — `globals.css`, בערכה הבהירה ובכהה.

**ערכת נושא** — בהיר / כהה / אוטומטי לפי המכשיר, כמו בורר הערכה ב-web ובאותו מפתח
(`mv-theme`). הבחירה חלה גם על מסכי ה-web המוטמעים (סקריפט שרץ לפני התוכן קובע את
`data-theme` ושומר את הבחירה ב-localStorage של הדפדפן המוטמע), ובחירה מתוך עמוד
הפרופיל במערכת חוזרת לאפליקציה. הערכה הכהה ב-`src/theme.ts` היא `--dk-*` מ-`globals.css`
ונבדקת ב-`verify:theme` יחד עם הבהירה.

מטמון לא-מקוון: כל רשימה וכרטיס נפתחים על מה שנטען בפעם הקודמת ומתרעננים;
בלי רשת מוצגת שורת „אין חיבור — מוצג מה שנטען לפני X”.

## הרצה מקומית

```bash
pnpm install
pnpm --filter @metavchim/shared build          # Metro טוען את dist/ של החבילה
cp apps/mobile/.env.example apps/mobile/.env   # ולכתוב את כתובת המחשב ברשת
pnpm --filter @metavchim/mobile start          # Expo Go בטלפון, או i / a לסימולטור
```

**כתובת ה-API היא כתובת המחשב ברשת המקומית** (`http://192.168.x.x:3001`), לא
`localhost` — על המכשיר `localhost` הוא המכשיר עצמו. ה-API מאזין על כל הממשקים,
ו-CORS אינו רלוונטי: האפליקציה אינה דפדפן ואינה שולחת `Origin`.

בפעם הראשונה הפריסה עשויה להיות משמאל לימין — `forceRTL` נכנס לתוקף בהפעלה
הבאה. בבניית ייצור זה נקבע כבר בהתקנה (`extra.supportsRTL`).

**ב-Expo Go אין פוש מרוחק** (מגבלה של Expo מ-SDK 53) — לבדיקת התראות צריך
Development Build (`eas build --profile development`).

## APK לבדיקות ידניות (לפני החנויות)

שתי דרכים לקבל קובץ שמתקינים ישירות על מכשיר אנדרואיד:

1. **Releases ⟵ `mobile-latest`** — ה-APK העדכני, תמיד באותה כתובת:
   `https://github.com/multidigitalltd/metavchim/releases/tag/mobile-latest`. ה-workflow
   „Mobile APK” בונה אותו **אוטומטית על כל מיזוג ל-main** שנוגע ב-`apps/mobile` או
   ב-`packages/shared` (כתובת השרת הצרובה: הייצור), ומחליף את הקובץ הקודם. מורידים
   למכשיר, מאשרים „התקנה ממקורות לא ידועים”, מתקינים מעל הגרסה הקיימת. איזה קומיט
   מותקן — במסך „האפליקציה”, בשורת הגרסה. אפשר גם להריץ ידנית („Run workflow”) עם כתובת
   API אחרת; אז הקובץ ב-Artifacts של הריצה.
2. **מקומית**, עם Android SDK ו-Java 17 מותקנים:

   ```bash
   pnpm --filter @metavchim/shared build
   cd apps/mobile && npx expo prebuild --platform android --no-install
   cd android && EXPO_PUBLIC_API_URL=https://app.metavchim.co.il \
     ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
       -Pandroid.enableMinifyInReleaseBuilds=true \
       -Pandroid.enableShrinkResourcesInReleaseBuilds=true \
       -Pexpo.useLegacyPackaging=true
   # → android/app/build/outputs/apk/release/app-release.apk (‎~22MB; בלי הדגלים: ‎~110MB)
   ```

ה-APK חתום במפתח הדיבאג של התבנית — מתאים לבדיקות, לא לחנות. כתובת השרת
צרובה ואינה מוצגת; **לבדיקות מול שרת אחר** — לחיצה ארוכה (שנייה וחצי) על הלוגו
במסך ההתחברות פותחת „הגדרות מתקדמות”; ריק חוזר לכתובת הצרובה. פוש נייטיב דורש מזהה פרויקט EAS (ראו למטה); בלעדיו האפליקציה מדווחת
„לא זמין בסביבה הזו”, וכל השאר עובד.

**„האפליקציה לא נותנת להתחבר”** — כמעט תמיד השרת שהאפליקציה מדברת איתו עדיין
מריץ גרסה ישנה: ההתחברות מהנייד דורשת שרת שמכיר `client: "mobile"` (ההודעה:
„השרת לא החזיר Session לאפליקציה — יש לעדכן את השרת”). השרת מתעדכן מכפתור
„עדכן גרסה” ב-/platform אחרי שה-CI של main סיים לפרסם. הנתונים עצמם אינם
עניין של סנכרון: האפליקציה קוראת וכותבת את אותו מסד דרך אותו API, ומה שנשמר
במחשב מופיע בנייד ברענון הבא, ולהפך.

מה לבדוק ידנית: התחברות (כולל סיסמה זמנית, וגם עם Google כשמוגדר), „היום”, ליד חדש ← חיוג/וואטסאפ
← סטטוס והערה, נכס ← עריכה, לקוח ← עריכה, משימה מכרטיס, „קול” (הקלטה
ותמלול דורשים שירות תמלול פעיל בשרת), התראות, מצב טיסה (המטמון), התנתקות.

## בנייה לחנויות (EAS)

חד-פעמי, בחשבון Expo של הארגון:

```bash
npm i -g eas-cli && eas login
cd apps/mobile && eas init            # כותב את projectId ל-app.json (extra.eas.projectId)
eas credentials                       # חתימה: Apple Developer + Google Play (מפתחות בשרתי EAS)
```

ואז, לפי הפרופילים ב-`eas.json`:

```bash
eas build --profile preview --platform all      # הפצה פנימית (TestFlight / APK)
eas build --profile production --platform all   # לחנויות
eas submit --profile production --platform all
```

`EXPO_PUBLIC_API_URL` נקבע לכל פרופיל ב-`eas.json` ונצרב בזמן הבנייה. הפוש
עובר דרך Expo Push Service ואינו דורש מפתחות מצד השרת; עבור iOS נדרש
APNs key בחשבון ה-EAS (מוגדר ב-`eas credentials`), ועבור Android — FCM V1
(מפתח שירות של Firebase, גם הוא ב-`eas credentials`).

## איך זה מתחבר

- **Session** — `POST /auth/login` עם `client: "mobile"` מחזיר את הטוקן בגוף; הוא נשמר
  ב-Keychain / Keystore (`src/lib/session-store.ts`) ונשלח בכותרת `Authorization: Bearer`
  (`src/lib/api.ts`). בשרת: `apps/api/src/common/session-token.ts`.
- **Google** — אותם נתיבים כמו ב-web, בדפדפן של המכשיר (`expo-web-browser`):
  `GET /auth/google/start?client=mobile` → Google → `google/callback`, שמסיים לנייד
  בהפניה ל-`metavchim://auth/google?code=…` (קוד חד-פעמי לדקה, ב-Redis) ולא בעוגייה;
  `POST /auth/google/exchange` ממיר את הקוד ל-Session בגוף. כתובת החזרה, צורת הקוד
  והנוסחים יושבים ב-`packages/shared/src/logic/mobile-auth.ts`. **לא נדרש שינוי
  ב-Google Cloud Console**: כתובת ה-callback המאושרת נשארת זו של השרת.
- **מסכי ה-web בתוך האפליקציה** — `app/web/[...path].tsx` מציג כל נתיב של המערכת
  ב-WebView, בלי המעטפת של ה-web (עוגיית `mv_embedded` → `AppShell` מרנדר תוכן בלבד).
  ה-Session: בפתיחה הראשונה לכל התחברות האפליקציה מבקשת קוד חד-פעמי
  (`POST /auth/web-session`, עם ה-Bearer) ופותחת את `GET /auth/web-session/:code?next=…`,
  שמכניס את **אותו** Session לעוגייה ומפנה למסך; מכאן העוגייה חיה בצנצנת של ה-WebView.
  אותו Session ולא חדש — שער „חיבור אחד לחשבון” ב-web אינו רואה מכשיר שני. קישורי
  `tel:`, וואטסאפ ומארחים אחרים נפתחים מחוץ לאפליקציה; הפניה ל-`/login` מתוך המסך
  (Session שנגמר) מחזירה את האפליקציה למסך ההתחברות שלה. `routeFor(href)` ב-`nav.ts`
  מחליט לכל נתיב — נייטיבי כשיש, ואחרת מוטמע — וכך גם התראות ופוש נוחתים תמיד.
- **Push** — `POST /notifications/push/device` רושם את טוקן Expo של המכשיר; העובד
  שולח דרך Expo Push API באותה סריקה של פוש הדפדפן, מאותו מטען. ההסרה לפני התנתקות.
- **הרשאות** — `can(user, capability)` מהרשימה ש-`/auth/me` מחזיר, כמו ב-web. ברירת
  מחדל שלילית: מסך שמסתיר כפתור בטעות הוא תקלה; כפתור שייכשל הוא הבטחה שבורה.
- **שעון ישראל** — כל תאריך דרך `formatJerusalem*` מ-shared; כלל ה-ESLint
  `israel-time/device-clock` רץ גם כאן.
- **רשימה שנכשלה אינה „ריקה”** — `useQuery` מבחין בין שגיאה, טעינה, ריק ומטמון;
  `apiList` זורק על שדה חסר. אותם כללים כמו `verify:lists` ב-web.

## מבנה

```
app/                 ניתוב לפי קבצים (expo-router)
  _layout.tsx        RTL, גופנים, AuthProvider, ShellProvider, שומר הכניסה, המגירה, לחיצה על התראה
  login.tsx  forgot-password.tsx  change-password.tsx  auth/google.tsx
  today.tsx  voice.tsx  notifications.tsx  app-settings.tsx  calendar.tsx  matches.tsx
  leads/  properties/  buyers/   index (רשימה) · [id] · new / edit
  tasks/  index (הלוח) · new
  web/[...path].tsx  כל מסך של המערכת — ה-web מוטמע
src/lib/             api, auth, google-login, session-store, push, cache, use-query, nav, shell, theme, fonts, recorder, agent, format, labels, dtos
src/components/      Text, Screen (TopBar), Drawer, AuthShell, Logo, Card, Pill, Button, Field, Row, Chips, States, ProposalCard, CacheNotice
src/theme.ts         טוקני העיצוב — עותק של globals.css בשתי הערכות (נאכף ב-verify:theme), המעטפת הכהה, סולם הטיפוגרפיה
src/lib/theme.tsx    ThemeProvider (בהיר/כהה/אוטומטי), useTheme/useColors, makeStyles, הגשר לערכה ב-WebView
assets/fonts/        Almoni — המרה של woff2 מה-web ל-ttf
scripts/             make-icons.mjs (האייקונים מלוגו המערכת, sharp), verify-theme.mjs (שער הטוקנים)
```

## איכות

`pnpm typecheck` ו-`pnpm lint` מהשורש מריצים גם את החבילה הזו (turbo), ו-CI מריץ
`verify:theme`. אין בדיקות יחידה כאן בכוונה: הלוגיקה שראויה לבדיקה יושבת
ב-`packages/shared` (כולל `expo-push.ts`) ונבדקת שם.

## מה עוד לא

- **מסכים נייטיביים נוספים** — כל מה שאינו נייטיבי מוצג מה-web ועובד. פגישה חדשה,
  דחייה ותיעוד תוצאה של סיור נפתחים במסך הפגישה של המערכת (מוטמע); הצעה במייל —
  ממסך ההצעות של המערכת.
- הורדת קבצים מתוך מסך web מוטמע (ייצוא, PDF) נפתחת בדפדפן המכשיר.
