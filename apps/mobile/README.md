# @metavchim/mobile — האפליקציה לנייד

Expo (React Native) בתוך המונוריפו. צרכן של אותו API כמו ה-web, עם אותה חבילת
`@metavchim/shared`. ההחלטה, ההיקף ומה שעוד לא נבנה — [ADR-007](../../docs/adr/ADR-007-native-mobile-app.md).

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

## איך זה מתחבר

- **Session** — `POST /auth/login` עם `client: "mobile"` מחזיר את הטוקן בגוף; הוא נשמר
  ב-Keychain / Keystore (`src/lib/session-store.ts`) ונשלח בכותרת `Authorization: Bearer`
  (`src/lib/api.ts`). בשרת: `apps/api/src/common/session-token.ts`.
- **הרשאות** — `can(user, capability)` מהרשימה ש-`/auth/me` מחזיר, כמו ב-web. ברירת
  מחדל שלילית: מסך שמסתיר כפתור בטעות הוא תקלה; כפתור שייכשל הוא הבטחה שבורה.
- **שעון ישראל** — כל תאריך דרך `formatJerusalem*` מ-shared; כלל ה-ESLint
  `israel-time/device-clock` רץ גם כאן.
- **רשימה שנכשלה אינה „ריקה”** — `useQuery` מבחין בין שגיאה, טעינה וריק; `apiList`
  זורק על שדה חסר. אותם כללים כמו `verify:lists` ב-web.

## מבנה

```
app/                 ניתוב לפי קבצים (expo-router)
  _layout.tsx        RTL, AuthProvider, שומר הכניסה
  login.tsx
  (tabs)/            היום · לידים · נכסים · לקוחות · עוד
  leads/[id].tsx  properties/[id].tsx  buyers/[id].tsx  notifications.tsx
src/lib/             api, auth, session-store, use-query, format, labels, dtos
src/components/      Text, Screen, Card, Pill, Button, Field, Row, Chips, States
src/theme.ts         טוקני העיצוב — עותק מסומן של globals.css
```

## איכות

`pnpm typecheck` ו-`pnpm lint` מהשורש מריצים גם את החבילה הזו (turbo). אין בדיקות
יחידה כאן בכוונה: הלוגיקה שראויה לבדיקה יושבת ב-`packages/shared` ונבדקת שם.

## בנייה לחנויות

לא מוגדרת עדיין (EAS). האייקונים ב-`assets/` הם ממלאי מקום בצבע הראשי — להחליף
לפני פרסום.
