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
| `pnpm audit --audit-level high` | ✅ אין high/critical. **2 moderate** ב-`qs` — זוהו דרך OSV ותוקנו ב-override (ממצא 8) |

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

3. **מסכים בלי `<h1>`:** `/buyers`, `/matches`, `/calendar`, `/settings`,
   `/settings/billing`, `/setup`. הסרגל העליון מציג את שם המסך ב-`<p>`
   בכוונה (הכותרת הסמנטית שייכת לתוכן), ושישה מסכים לא סיפקו אותה —
   קורא מסך איבד את נקודת העיגון. axe אינו מסמן זאת (best-practice ולא
   כלל AA). נוסף `<h1 class="sr-only">` עם שם המסך בכל אחד מהם.
4. **אובייקט הדרישות של הקונה לא היה `strict`:** `CreateBuyerSchema` הוא
   `.strict()`, אבל `BuyerRequirementsSchema` שבתוכו לא — מפתח שגוי
   (`minRooms` במקום `roomsMin`) נבלע בשקט והבקשה החזירה 201 בלי השדה.
   עכשיו `.strict()` גם על הפנימי בשלושת נתיבי הקלט (יצירה, עדכון,
   המרת ליד). הקריאה מהמסד נשארת סלחנית.
5. **סמנטיקה לא אחידה לרשימה ריקה בדרישות:** `cities: []` = בלי מגבלה
   (מתועד ומכוון), `propertyTypes: []` = „אין מספיק פרטים” והתאמה מוחרגת
   (`insufficientData`). הטופס דורש סוג נכס, אבל קונה שנקלט בייבוא או
   דרך ה-API מגיע בלעדיו, וכרטיס הקונה הראה „אין התאמות” בלי להגיד למה.
   כללי המנוע לא שונו (הם מכוונים ומכוסים בבדיקות); כרטיס הקונה מציג
   עכשיו התראה עם קישור להשלמה כשאין סוג נכס.
6. **רעש בקונסול בכל מסך:** `GET /settings/tenant/logo/raw` → 404 למשרד
   בלי לוגו, ו-`GET /auth/profile` → 401 בכל מסך ציבורי. שניהם הסתירו
   שגיאות אמיתיות למי שפותח DevTools.
   - הלוגו: `/auth/me` מחזיר עכשיו `tenantHasLogo` (מאותה שורת משרד
     שכבר נטענת, בלי שאילתה לכל בקשה), והסרגל מבקש את הקובץ רק אם כן.
     גם עורך הלוגו בהגדרות/בהקמה פותח מהדגל במקום לנחש „יש”. העלאה/הסרה
     מאפסות את מטמון ה-session כדי שהסרגל יתעדכן.
   - הנגישות: `/auth/me` משדר אירוע `mv:session-ready` כשהוא עונה,
     וסנכרון ההעדפות ממתין לו (או ל-session שכבר במטמון) במקום לבקש
     תמיד. במסך ציבורי אין בקשה, והמטמון המקומי נשאר בתוקף.
7. **סוויטת ה-RLS השאירה שאריות במסד:** `afterAll` רק ניתק; נשארו שורות
   ב-`audit_log` וב-`matches` של הדיירים המדומים (אין cascade). עכשיו
   ה-`afterAll` מוחק מכל טבלה שנשתלה, באותו מצב שבו נשתלה (FK ו-RLS
   כבויים, בתפקיד הבעלים).

8. **`pnpm audit`: 2 moderate** — הרישום של npm לא ענה ל-`pnpm audit`
   מהמכונה, ולכן זוהו דרך OSV על כל 711 הגרסאות שבקובץ הנעילה: שתיהן
   ב-`qs@6.15.3` (תלות של Express): GHSA-4mjr-xmp4-gh2g (DoS דרך
   `isBuffer`) ו-GHSA-x5fp-wj9c-mxmx (עקיפת `arrayLimit`), שתיהן מתוקנות
   ב-6.16.0. נוסף override `qs@<6.16.0 → ^6.16.0` ב-`package.json`, כמו
   שאר ה-overrides שם; אחרי העדכון OSV מחזיר אפס גרסאות פגיעות.

### לא תוקנו — לשיקול

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
