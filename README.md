# מתווכים — מערכת ניהול למשרדי תיווך

> המתווך סוגר עסקאות. המערכת מטפלת בכל השאר.

SaaS רב-דיירים (Multi-Tenant) למשרדי תיווך: לידים מכל הערוצים, נכסים, קונים ושוכרים,
מנוע התאמות, הצעות בוואטסאפ ובמייל, סוכן אישי (קולי ובוואטסאפ), יומן ואוטומציות,
שיחות עם תמלול וסיכום, הסכמים בחתימה דיגיטלית ורשת שיתופי פעולה בין משרדים.

| מה מחפשים | איפה |
|-----------|------|
| **מה המערכת עושה** (למשתמשים, בלי התחברות) | `/docs` בסביבה רצה — אותו תוכן שב-`/guides` בתוך המערכת; Markdown ב-`/docs/md` |
| **קליטת לידים ממקורות חיצוניים** (API, Make, n8n) | `/docs/api` |
| **חיבור שיחות ומרכזייה** | `/docs/telephony` |
| **חיבור וואטסאפ עסקי** (Meta Cloud API, שלב אחרי שלב) | `/docs/whatsapp` · מצב המימוש ב-[docs/whatsapp-setup.md](docs/whatsapp-setup.md) |
| **התכנון המלא** — ארכיטקטורה, נתונים, אבטחה, אינטגרציות, נגישות, ביצועים, תפעול, פריסה | [docs/README.md](docs/README.md) |
| **איך כותבים תיעוד והדרכות** | [docs/12](docs/12-docs-and-guides.md) |

## מבנה הריפו (Monorepo)

```
apps/
  api/       NestJS — ה-API וכל מודולי הדומיין; Prisma + מיגרציות עם RLS
  web/       Next.js (React) — PWA בעברית, RTL, נגישה (ת"י 5568 / WCAG 2.2 AA)
  workers/   BullMQ — עיבוד רקע (תמלול, התאמות, שליחות, תזכורות)
packages/
  shared/    סכמות Zod, חוזי אירועים, RBAC, לוגיקה עסקית — אמת אחת לכל האפליקציות
  ui/        רכיבי Design System נגישים
docs/        מסמכי תכנון, תפעול ו-ADRs
infra/       Docker, Caddy, סקריפטי פריסה
scripts/     כלי עזר לפיתוח ולתפעול
```

## פיתוח מקומי

```bash
pnpm install
docker compose up -d                # PostgreSQL, Redis, MinIO, Mailpit
cp .env.example .env                # ולעדכן ערכים במידת הצורך

pnpm --filter @metavchim/api db:migrate   # סכמה + RLS (הכל במיגרציות מנוהלות)
psql "postgresql://metavchim:metavchim@localhost:5432/metavchim" \
  -c "SET app.provision_password = 'metavchim_app_dev_16ch'" \
  -f apps/api/prisma/sql/create_app_role.sql   # תפקיד אפליקציה מוגבל (סיסמה = חובה)
pnpm --filter @metavchim/api db:seed      # סוכנויות דמו (demo-a/b@metavchim.local / Demo1234!)

pnpm dev                            # web על :3000, api על :3001
```

## איכות — מה רץ ב-CI ומה מריצים לפני PR

```bash
pnpm lint · pnpm typecheck · pnpm test · pnpm build
```

ובנוסף שערי ה-web, שכל אחד מהם נולד מתקלה אמיתית שעברה את כל השערים שמעליו:

| פקודה (`pnpm --filter @metavchim/web …`) | תופס |
|---|---|
| `verify:contrast` | זוג צבעים מתחת לסף בכל ערכה — בהיר, כהה, ניגודיות גבוהה |
| `verify:typography` | טקסט מתחת ל-14px או משקל גופן דק |
| `verify:assets` | תמונה חסרה, קישור פנימי ל-404, מדריך עם הפניה שגויה |
| `verify:language` | ניסוח מסחרי במסכי ההפניות (התמורה על ההפניה, לא על הלקוח) |
| `verify:scroll` · `verify:cards` | לשונית שנחתכת בלי רמז גלילה · תוכן שנוגע במסגרת הכרטיס |
| `verify:lists` · `verify:shapes` | רשימה שנכשלה ומוצגת כריקה · צורת תשובה שלא תואמת את הבקר |

## עקרונות מחייבים (מפורטים ב-docs)

- **אבטחה**: בידוד דיירים תלת-שכבתי (Scope → Policy → RLS), ולידציית Zod בכל קלט, Audit מלא. אין PR שעוקף את זה — [docs/04](docs/04-security-privacy.md).
- **נגישות**: ת"י 5568 / WCAG 2.2 AA מובנית בכל רכיב, התאמות אישיות בפרופיל וכפתור נגישות בדפים הציבוריים, נאכפת ב-CI — [docs/06](docs/06-ux-accessibility.md).
- **ביצועים**: שום עבודה כבדה ב-Request; הכל בתורים. יעדי SLO ב-[docs/07](docs/07-performance.md).
- **מה שיוצא ללקוח — באישור בן אדם**: המערכת מנסחת הצעה, הסכם או מייל; המתווך שולח.
- **מקור אמת אחד**: תוכן ההדרכות ב-`apps/web/src/lib/guide-content.ts`, טוקני עיצוב ב-`globals.css`, לוגיקה עסקית ב-`packages/shared`.
