# בדיקת QA מלאה — 4.9.2026

**מה נבדק:** `main` בקומיט `afdae39` (PR #399), כל המערכת — לא ענף בודד.
**איפה:** מכונה נקייה, Node 22.22, pnpm 10.33, PostgreSQL 16 ו-Redis מקומיים
(בלי Docker daemon, ולכן בלי MinIO ובלי בניית תמונות).

## 1. השערים הסטטיים (מה ש-CI מריץ)

| שער | תוצאה |
|-----|-------|
| `prisma validate` + `prisma generate` | ✅ |
| `pnpm lint` (api, web, workers, shared, ui) | ✅ |
| `pnpm test:eslint-rules` (`israel-time/device-clock`) | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` — shared: 139 קבצים / 2,942 בדיקות · api: 99 קבצים / 1,189 בדיקות (+1 מדולגת) | ✅ |
| `pnpm build` (shared, api, workers, web) | ✅ |
| `verify:assets` · `verify:language` · `verify:typography` · `verify:contrast` · `verify:scroll` · `verify:lists` · `verify:shapes` · `verify:cards` | ✅ כולם |
| `verify:boot` (גרף התלויות של Nest על `dist`) | ✅ |
| `verify:iac` (תבנית Ansible מול `.env.production.example`) | ✅ |
| `ansible-playbook --syntax-check site.yml` | ✅ |
| `test:rls` — בידוד דיירים מול Postgres אמיתי (8 קבצי `*.int.test.ts`, 62 בדיקות) | ✅ |
| `pnpm audit --audit-level high` | ✅ אין high/critical. **2 moderate** — פירוטן לא התקבל (הרישום של npm ענה ב-timeout דרך ה-proxy שלוש פעמים מתוך ארבע) |

שערים שקיימים בריפו **ואינם** ב-CI — הורצו גם הם, כולם ירוקים:
`verify-destructive-confirm` · `verify-docs` · `verify-screen-layout` ·
`verify-backup-chain` · `verify-effective-capabilities` · `verify-notification-routes` ·
`verify-stt-prompt`.

`prettier --check .` נכשל על רוב הקבצים — אין `.prettierrc`, ו-CI אינו מריץ אותו.
זה מצב קיים ולא ממצא של הסבב הזה.

## 2. הרצה חיה — API, Web, Workers

מיגרציות (`migrate deploy`) + `create_app_role.sql` + seed רצו נקי. ה-API עלה עם
`metavchim_app` (התפקיד המוגבל), ה-Workers עלו (`notifications`, `low`), וה-Web
נבנה כמו בייצור (`NEXT_PUBLIC_API_URL=""`) מאחורי proxy שמדמה את ה-Caddyfile —
`/api/*` ל-3001 והשאר ל-3000, מקור אחד.

| בדיקה | תוצאה |
|-------|-------|
| `GET /health` · `GET /health/deep` (DB + Redis) | ✅ 200 |
| 44 מסכים בדפדפן (Playwright/Chromium): 11 ציבוריים + 33 מאחורי התחברות | ✅ כולם נטענו, בלי שגיאות JS, בלי „לא הצלחנו לטעון” |
| דפי ישות: נכס, עריכת נכס, קונה, עריכת דרישות, ליד; מזהה לא קיים; מזהה לא חוקי | ✅ מוצגים; 404/400 מטופלים במסך |
| טופס „ליד חדש” ו„נכס חדש” — מילוי ושליחה מהדפדפן | ✅ נוצרו (201) ונחתו בכרטיס |
| מנוע ההתאמות מקצה לקצה: נכס פעיל + קונה עם עיר, תקציב וסוג נכס | ✅ התאמה 100% ב-API ובמסך „התאמות” |
| axe-core (WCAG 2.0/2.1/2.2 A+AA) על דשבורד, לידים, נכסים, קונים, הגדרות, התחברות, תיעוד | ✅ 0 הפרות |
| משתמש לא מחובר ב-`/leads` | ✅ הפניה ל-`/login` |
| `/guides` | ✅ הפניה ל-`/docs` |
| נתיב לא קיים | ✅ 404 עם עמוד „העמוד לא נמצא” |

### בדיקות אבטחה (curl מול ה-API)

| בדיקה | תוצאה |
|-------|-------|
| 8 נתיבים מוגנים בלי session | ✅ 401 |
| קונה/ליד של משרד א׳ מתוך session של משרד ב׳ — GET / PATCH / DELETE / רשימה | ✅ 404, 404, 404, לא ברשימה |
| בעלים של משרד מול `/platform/*` | ✅ 403 |
| סיסמה שגויה ×12 (מייל אחד, IP אחד) | ✅ 401 ×5 ואז 429 |
| קלט שאינו תואם Zod (מפתח לא מוכר, אימייל לא חוקי, סיסמה קצרה) | ✅ 400 עם `issues` |
| גוף של 3MB | ✅ 413 |
| Webhooks ציבוריים כשהסודות לא מוגדרים | ✅ 404 |
| `Origin` זר על `POST /auth/login` | ✅ 403 (`OriginGuard`) — ובלי `Access-Control-Allow-Origin` |
| עוגיית session | ✅ `HttpOnly; SameSite=Lax; Path=/` (`Secure` כבוי בפיתוח בלבד — `COOKIE_SECURE`) |
| כותרות: HSTS, `nosniff`, `X-Frame-Options`, CSP עם nonce ו-`strict-dynamic`, `Referrer-Policy` | ✅ |
| יומן ביקורת אחרי יצירת ליד | ✅ `lead.create` |
| מילוי טופס נכס יוצר איש קשר של בעל הנכס ומוחק אותו עם הנכס (`contactDeleted: true`) | ✅ |

## 3. ממצאים

### תוקנו ב-PR הזה

1. **`pnpm dev` מהשורש חסם כל קריאה ל-API ב-CSP.** `lib/api.ts` נופל
   ל-`http://localhost:3001` כשהמשתנה `NEXT_PUBLIC_API_URL` אינו מוגדר,
   אבל `middleware.ts` נפל לריק — ו-Next קורא רק את `.env` של `apps/web`,
   לא את `.env` של השורש שה-README מורה ליצור. התוצאה: `connect-src 'self'`
   בלבד, 43 חסימות במסך ההתחברות, וההתחברות נכשלת בלי שום הודעה (הפעם
   הראשונה של הבדיקה הזו נראתה בדיוק כך). בפרודקשן זה לא קרה, כי ה-Dockerfile
   מגדיר את המשתנה כריק במפורש. התיקון: אותה ברירת מחדל בשני המקומות.
   אומת: `next dev` בלי המשתנה מייצר עכשיו `connect-src 'self' http://localhost:3001`,
   ובנייה עם `""` נשארת `'self'`.
2. **אזהרה בעליית ה-API:** `LegacyRouteConverter — Unsupported route path "/api/v1/*"`.
   `forRoutes("*")` הוא תחביר Express 4; ב-Express 5 (Nest 11) הכתיב הוא
   `{*splat}`. אומת שהמידלוור עדיין חל על הכול (401 בלי session, 429 בהצפה).

### לא תוקנו — לשיקול

3. **מסכים בלי `<h1>`:** `/buyers`, `/matches`, `/calendar`, `/settings`,
   `/settings/billing`, `/setup`. הכותרת שם היא טקסט מעוצב ולא כותרת. axe אינו
   מסמן זאת (זה best-practice ולא כלל AA), אבל בדף שכל שאר המסכים שלו
   פותחים ב-`h1` — קורא מסך מאבד את נקודת העיגון. ראו `leads/page.tsx:240`
   לדפוס הנכון.
4. **אובייקט הדרישות של הקונה אינו `strict`:** `CreateBuyerSchema` הוא
   `.strict()`, אבל `BuyerRequirementsSchema` שבתוכו לא — מפתח שגוי
   (`minRooms` במקום `roomsMin`) נבלע בשקט והבקשה מחזירה 201 בלי השדה.
   לטופס זה לא קורה; לצרכן API חיצוני או לייבוא — כן.
5. **סמנטיקה לא אחידה לרשימה ריקה בדרישות:** `cities: []` = בלי מגבלה
   (מתועד ומכוון), `propertyTypes: []` = „אין מספיק פרטים” והתאמה מוחרגת
   (`insufficientData`). הטופס דורש סוג נכס ולכן משתמשים לא נתקלים בזה,
   אבל קונה שנוצר דרך API/ייבוא בלי סוג נכס לעולם לא יקבל התאמה — ובלי
   הודעה. שווה או `strict` בקלט, או שורה בהסבר במסך הקונה.
6. **רעש בקונסול בכל מסך:** `GET /settings/tenant/logo/raw` → 404 למשרד
   בלי לוגו (החלטה מתועדת ב-`office-logo-mark.tsx`), ו-`GET /auth/profile` →
   401 בכל מסך ציבורי (סנכרון הנגישות רץ גם לאורח). שניהם לא שוברים
   דבר, אבל מסתירים שגיאות אמיתיות למי שפותח DevTools.
7. **סוויטת ה-RLS משאירה שאריות במסד:** `afterAll` מנתק בלבד; אחרי הריצה
   נשארו 2 שורות ב-`audit_log` ו-2 ב-`matches` של הדיירים `01TENANTA…/B…`
   (הדיירים עצמם נמחקו, לטבלאות האלה אין cascade). ב-CI המסד חד-פעמי; על
   מסד פיתוח משותף זה מצטבר.
8. **`pnpm audit`: 2 moderate** — ראו §1. כדאי להריץ מקומית ולראות מה הן.
9. **`next start` מזהיר** ש-`output: "standalone"` דורש
   `node .next/standalone/server.js`. רלוונטי רק למי שמריץ `pnpm start`
   מחוץ ל-Docker.

## 4. מה לא כוסה

- אינטגרציות חיצוניות: WhatsApp Cloud API, טלפוניה/SIP, תמלול, Gemini, מייל,
  S3/MinIO (ה-API עלה עם `אחסון אובייקטים לא זמין` ותפקד בלי מדיה), Cardcom/Linet.
- בניית תמונות Docker ו-`docker-compose.prod.yml` (אין daemon במכונה).
- ביצועים (Lighthouse/SLO) — לא נמדדו.
- אימות דו-שלבי בכניסה (`otp.isActive()` כבוי בלי ספק מייל).

## 5. איך לשחזר

```bash
pnpm install --frozen-lockfile
pnpm --filter @metavchim/api exec prisma validate && pnpm --filter @metavchim/api exec prisma generate
pnpm lint && pnpm test:eslint-rules && pnpm typecheck && pnpm test && pnpm build
for g in assets language typography contrast scroll lists shapes cards; do pnpm --filter @metavchim/web verify:$g; done
pnpm --filter @metavchim/api verify:boot && pnpm verify:iac
# מול Postgres מקומי (ראו ci.yml, משימת cross-tenant):
pnpm --filter @metavchim/api test:rls
```
