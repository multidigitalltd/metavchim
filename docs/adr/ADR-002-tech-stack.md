# ADR-002 · סטאק: Laravel + Vue/Inertia + PostgreSQL + Redis

**סטטוס:** מוצע · **תאריך:** 2026-07-27

## הקשר
נדרש סטאק שמאפשר מהירות פיתוח, אבטחה בשלה, תורים ועיבוד רקע חזקים, RTL מלא — ושמנצל את היכולות הקיימות של הצוות (רקע PHP חזק מעולם ה-WordPress, תקן PHP 8.3+).

## החלטה
- **Backend: PHP 8.3 + Laravel 11** — Queues+Horizon, Scheduler, Policies, Broadcasting (Reverb), Cashier; אקוסיסטם אבטחה בשל; מעבר טבעי לצוות PHP.
- **Frontend: Vue 3 + Inertia.js כ-PWA** — חוויית SPA בלי API-Client כפול; RTL מצוין.
- **DB: PostgreSQL 16** — Row-Level Security (קריטי לבידוד דיירים), JSONB, pgvector.
- **Redis** — Cache, תורים, Rate Limit, Locks.
- **S3-compatible Storage** להקלטות/מדיה.

## חלופות שנשקלו
- **NestJS + Next.js** — שקול טכנית (יתרון קל ב-Realtime/Streaming לסוכן הקולי); נדחה כברירת מחדל כי מרחיק את הצוות הקיים מהקוד. אם יגויס צוות Node ייעודי — ניתן לפתיחה מחדש לפני תחילת שלב 0.
- **MySQL** — נדחה: אין RLS אמיתי; RLS הוא שכבת הביטחון השלישית בבידוד דיירים.
- **SPA נפרד + REST מלא** — נדחה ל-MVP: תחזוקת חוזה כפולה; ה-API הציבורי ייחשף בשלב 4 מתוך אותם Controllers.

## השלכות
- (+) זמן-לשוק קצר; שפה אחת לצוות; ספריות בדוקות לכל צורך תשתיתי.
- (−) Streaming בזמן-אמת לסוכן הקולי פחות טבעי ב-PHP — ממותן ע"י בחירת פלטפורמת Voice מנוהלת (ADR-005) שמחזיקה את ה-Streaming אצלה.
