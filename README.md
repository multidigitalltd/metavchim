# מערכת 360 למתווכים

> המתווך סוגר עסקאות. המערכת מטפלת בכל השאר.

SaaS רב-דיירים (Multi-Tenant) למשרדי תיווך: לידים, נכסים, קונים, מנוע התאמות, הצעות בוואטסאפ, סוכן קולי, יומן ושיתופי פעולה בין סוכנויות.

**התכנון המלא**: [docs/](docs/README.md) — ארכיטקטורה, מודל נתונים, אבטחה, אינטגרציות, נגישות, ביצועים, תפעול ומפת דרכים.

## מבנה הריפו (Monorepo)

```
apps/
  api/       NestJS — ה-API וכל מודולי הדומיין
  web/       Next.js (React) — PWA בעברית, RTL, נגישה
  workers/   BullMQ — עיבוד רקע (תמלול, התאמות, שליחות)
packages/
  shared/    סכמות Zod, חוזי אירועים, RBAC — אמת אחת לכל האפליקציות
  ui/        רכיבי Design System נגישים
docs/        מסמכי תכנון ו-ADRs
```

## פיתוח מקומי

```bash
pnpm install
docker compose up -d          # PostgreSQL, Redis, MinIO, Mailpit
cp .env.example .env          # ולעדכן ערכים במידת הצורך
pnpm --filter @metavchim/api prisma:generate
pnpm dev                      # web על :3000, api על :3001
```

בדיקות ואיכות: `pnpm typecheck` · `pnpm lint` · `pnpm build`

## עקרונות מחייבים (מפורטים ב-docs)

- **אבטחה**: בידוד דיירים תלת-שכבתי (Scope → Policy → RLS), ולידציית Zod בכל קלט, Audit מלא. אין PR שעוקף את זה.
- **נגישות**: ת"י 5568 / WCAG 2.2 AA — מובנית בכל רכיב, נאכפת ב-CI.
- **ביצועים**: שום עבודה כבדה ב-Request; הכל בתורים. יעדי SLO ב-[docs/07](docs/07-performance.md).
