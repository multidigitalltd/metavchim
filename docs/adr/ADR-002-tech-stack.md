# ADR-002 · סטאק: TypeScript מקצה לקצה — NestJS + Next.js + PostgreSQL + Redis

**סטטוס:** מאושר · **תאריך:** 2026-07-27

## הקשר
נדרש סטאק שמאפשר מהירות פיתוח, אבטחה בשלה, תורים ועיבוד רקע חזקים, Realtime וסטרימינג (סוכן קולי, התראות חיות, סטרימינג LLM), RTL מלא, וגיוס קל בשוק הישראלי. אין מחויבות ל-PHP (אושר ע"י המזמין).

## החלטה
- **Backend: NestJS (Node 22, TypeScript)** — מערכת המודולים המובנית ממפה אחד-לאחד על ה-Modular Monolith (ADR-001); DI, Guards (הרשאות), Pipes (ולידציה) מובנים; Node מצטיין בדיוק ברכיבים הקשים של המוצר: WebSockets, סטרימינג אודיו/LLM.
- **Frontend: Next.js (React) כ-PWA** — מאגר המפתחים הגדול בישראל; SSR מהיר לדפי ההצעה ללקוח קצה; RTL מלא.
- **UI: Radix UI + Tailwind** — רכיבים Headless נגישים מיסודם (ת"י 5568 / WCAG 2.2 AA).
- **טיפוסים משותפים**: Monorepo (pnpm + Turborepo) עם חבילת `shared` — סכמות Zod אחת לשרת, ל-Workers ולממשק.
- **ORM: Prisma** — טיפוסים מה-DB ועד הממשק; מיגרציות מנוהלות.
- **תורים: BullMQ** על Redis — Jobs, Retry/Backoff, תזמון, Rate Limiting פר-תור.
- **DB: PostgreSQL 16** — Row-Level Security (קריטי לבידוד דיירים), JSONB, pgvector.
- **Realtime: WebSockets (Socket.IO דרך NestJS Gateway)**.
- **S3-compatible Storage** להקלטות/מדיה.

## חלופות שנשקלו
- **Laravel (PHP 8.3) + Vue/Inertia** — ההמלצה המקורית בהנחת צוות PHP. משנפלה ההנחה: Node עדיף ב-Realtime/סטרימינג, שפה אחת לכל הסטאק, וגיוס קל יותר. נדחה.
- **Python (Django/FastAPI)** — אקוסיסטם AI מצוין, אבל Realtime ופרונט חלשים יותר; היה מחייב שתי שפות. נדחה.
- **Go** — ביצועים מעולים אך פיתוח מוצר איטי יותר; היתרון לא נדרש בפרופיל העומס הצפוי. נדחה.
- **Elixir/Phoenix** — הטוב ביותר טכנית ל-Realtime, אבל מאגר גיוס זעום בישראל. נדחה.

## השלכות
- (+) שפה אחת + טיפוסים משותפים = פחות באגי חוזה בין שרת לממשק, תחזוקה יומיומית קלה.
- (+) סטרימינג טבעי — מסלול פתוח לצנרת קולית עצמית בעתיד (מקל על ADR-005).
- (+) SDKs של ספקי AI/Voice/WhatsApp מתוחזקים ב-TS כשפה ראשונה.
- (−) פחות "כולל סוללות" מ-Laravel (Billing, Auth מובנים) — ממותן בספריות בשלות: Auth.js/Lucia, Stripe SDK, ו-NestJS ecosystem.
- (−) נדרשת משמעת ב-async (טיפול שגיאות ב-Promises, Graceful Shutdown ל-Workers) — נאכף ב-Lint ותבניות קוד.
