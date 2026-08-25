# INDEX — Handoff for מתווכים.

Read in this order.

## Design system (applies to EVERY screen)
1. `DESIGN-SYSTEM-1-foundations.md` — colours, domain palettes, type scale, hard floors
2. `DESIGN-SYSTEM-2-icons-and-controls.md` — icons, buttons, chips, inputs, badges
3. `DESIGN-SYSTEM-3-patterns.md` — card anatomy, rows, KPI, empty states, hover
4. `DESIGN-SYSTEM-4-layout-and-rules.md` — shell, grid, spacing, RTL, a11y, do and do-not

## Screen specs (build these exactly)
5. `README.md` — Dashboard
6. `SPEC-2-properties-list.md` — Properties list
7. `SPEC-3a-header.md` — Property card: back link + header card
8. `SPEC-3b-readiness.md` — Tab strip + readiness card
9. `SPEC-3c-details.md` — Details card, side column, behaviour
10. `SPEC-4a-matches.md` — Tabs: התאמות, נכסים תואמים
11. `SPEC-4b-network-owner.md` — Tabs: שיתופי פעולה, בעל הנכס
12. `SPEC-4c-exclusivity-tasks.md` — Tabs: בלעדיות, משימות

## Assets
- `fonts/almoni-*.woff` — 4 weights, load with `font-display: swap`. No Google Fonts, no Inter.
- `brand/` — logo SVGs and favicon.

> **הערה של המאגר — היכן הנכסים נמצאים בפועל.**
>
> - **הגופנים קיימים**, תחת `apps/web/public/fonts/`: `almoni-regular-aaa.woff`,
>   `almoni-medium-aaa.woff`, `almoni-bold-aaa.woff`, `almoni-ultrabold-aaa.woff`.
>   ארבעת המשקלים כנדרש, והם כבר נטענים ב-`apps/web/src/app/globals.css`.
> - **ספריית `brand/` לא נכללה בחבילה שהתקבלה.** אין בה `logo-mark`, `logo-mono`,
>   `favicon` ולא `app-icon-512`. מה שכן קיים במאגר: `apps/web/public/logo-mark-dark.svg`,
>   `apps/web/public/icon.svg` ו-`apps/web/public/manifest.webmanifest`.
>
> לכן: **אין לייצר תחליפים ואין לנחש.** נכס מיתוג שהמסמכים מבטיחים ואינו קיים — לשאול
> עליו, כפי שהכלל אומר: „אם משהו לא כתוב במסמכים — לשאול, לא לאלתר”. עד שיימסר, המימוש
> משתמש בקבצים הקיימים לעיל.

## Non-negotiables
- Hebrew, RTL: `dir="rtl"` on the html element; logical properties only
  (`margin-inline-start`, `inset-inline-start`) — never left/right.
- Numbers, currency, times, dates, ratios: `dir="ltr"` + `unicode-bidi: isolate`.
- One card system: white, border 1px #E3E7DE, radius 22px, padding 24px, shadow
  `0 1px 2px rgba(16,24,18,.04), 0 14px 32px -26px rgba(16,24,18,.32)`.
- Never below 13.5px. Body 15.5–16.5px. Brokers use this on the move; legibility beats density.
- Colour carries meaning, never decoration: green = money/deals/network · purple = demand and
  matching · blue = property/listings · amber = attention · red-clay = blocking problem ·
  neutral = everything else. One row stays in ONE domain.
- Every empty state names the action that fills it. No dead ends, no "no data".
- Never invent facts a record does not hold (no "נכנס לפני יומיים", no missing-price warning on
  a listing that has a price).
