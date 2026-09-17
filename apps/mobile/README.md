# @metavchim/mobile — האפליקציה לנייד

Expo (React Native) בתוך המונוריפו. צרכן של אותו API כמו ה-web, עם אותה חבילת
`@metavchim/shared`. ההחלטה, ההיקף ומה שעוד לא נבנה — [ADR-007](../../docs/adr/ADR-007-native-mobile-app.md).

## מה יש

| מסך | מה עושים |
|-----|----------|
| התחברות · החלפת סיסמה | אימייל+סיסמה, קוד אימייל כשמופעל; סיסמה זמנית חייבת להתחלף לפני הכול |
| היום | לידים שממתינים (מהשרת, הוותיק ראשון), הפגישות של היום, המשימות שלי עם „בוצע” |
| לידים · ליד חדש · ליד | סינון במסד, חיפוש; קליטה מהירה; חיוג, וואטסאפ, סטטוס, ציר זמן, הערה, משימה |
| קול | הסוכן האישי: הקלטה → תמלול → הצעה לאישור → ביצוע; או הקלדה |
| נכסים · נכס | פרטים, מוכנות ומה חסר, בעל הנכס, לקוחות מתאימים, משימה |
| לקוחות · לקוח | דרישות ומימון, נכסים מתאימים, משימה |
| משימה חדשה | מועד מהיר בשעון ישראל, עדיפות, קישור לישות |
| התראות · Push | רשימה, סימון כנקרא; התראות פוש למכשיר (Expo) עם ניווט לישות |
| עוד | מי מחובר, מצב ההתראות, התנתקות |

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
  _layout.tsx        RTL, AuthProvider, שומר הכניסה, לחיצה על התראה
  login.tsx  change-password.tsx  notifications.tsx
  (tabs)/            היום · לידים · קול · נכסים · לקוחות · עוד
  leads/new.tsx  leads/[id].tsx  properties/[id].tsx  buyers/[id].tsx  tasks/new.tsx
src/lib/             api, auth, session-store, push, cache, use-query, recorder, agent, format, labels, dtos
src/components/      Text, Screen, Card, Pill, Button, Field, Row, Chips, States, ProposalCard, CacheNotice
src/theme.ts         טוקני העיצוב — עותק של globals.css, נאכף ב-verify:theme
scripts/             make-icons.mjs (האייקונים מקוד), verify-theme.mjs (שער הטוקנים)
```

## איכות

`pnpm typecheck` ו-`pnpm lint` מהשורש מריצים גם את החבילה הזו (turbo), ו-CI מריץ
`verify:theme`. אין בדיקות יחידה כאן בכוונה: הלוגיקה שראויה לבדיקה יושבת
ב-`packages/shared` (כולל `expo-push.ts`) ונבדקת שם.

## מה עוד לא

- גופן Almoni — ה-web טוען woff2 ו-RN דורש ttf/otf; עד להמרה, גופן המערכת.
- עריכת נכס וקונה — הטפסים המלאים נשארים ב-web; מהנייד יוצרים ליד ומשימה, ופועלים דרך הסוכן.
- האייקונים נוצרים מקוד (`pnpm --filter @metavchim/mobile icons`); חבילת מיתוג מחליפה את `assets/`.
