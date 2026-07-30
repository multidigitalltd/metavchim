# 10 — פריסה לפרודקשן (VPS + Docker)

המערכת נפרסת כשבעה קונטיינרים על שרת יחיד: Postgres, Redis, MinIO,
‏API, Workers, Web, ‏Caddy (שער HTTPS) — ועוד **updater**, סוכן עדכון
זעיר שמאחורי כפתור "עדכן גרסה" במסך ההגדרות.

**זרימת גרסה:** מיזוג ל-`main` ⟵ CI בונה ארבע תמונות ודוחף ל-GHCR ⟵
בעל המשרד לוחץ "משוך ועדכן לגרסה האחרונה" ⟵ הסוכן מושך `:latest`
ומרים את api/web/workers מחדש (דקה, ללא מגע SSH).

## דרישות

- שרת Linux (‏2GB RAM ומעלה; Hetzner/DigitalOcean וכו') עם Docker Engine + Compose v2.
- דומיין שמצביע (רשומת A) על ה-IP של השרת — Caddy ינפיק תעודת TLS אוטומטית.
- פורטים 80 ו-443 פתוחים.

## הקמה ראשונית (פעם אחת)

```bash
# 1) הריפו על השרת (compose + Caddyfile חיים בו)
git clone https://github.com/multidigitalltd/metavchim.git /srv/metavchim
cd /srv/metavchim

# 2) התחברות ל-GHCR (אם חבילות התמונות פרטיות): PAT עם read:packages
docker login ghcr.io -u <github-user>

# 3) קובץ הסביבה — מלאו כל ערך ריק (הסודות עם: openssl rand -base64 32)
cp .env.production.example .env.production
nano .env.production

# 4) עליית התשתית והאפליקציה (מושך תמונות מ-GHCR).
#    בעלייה הראשונה נוצר אוטומטית תפקיד האפליקציה (RLS) ורצות המיגרציות.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# 5) הקמת הסוכנות הראשונה — מדפיס סיסמה זמנית פעם אחת
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node dist/scripts/bootstrap.js "שם המשרד" owner@example.com "שם הבעלים"
```

נכנסים ל-`https://<הדומיין>`, מתחברים עם הסיסמה הזמנית ומחליפים אותה.

## עדכון גרסה

**הדרך הרגילה — מתוך המערכת:** הגדרות ⟵ "מערכת" ⟵
"משוך ועדכן לגרסה האחרונה" (מוצג לבעלי הרשאת ניהול הגדרות). הפעולה
נרשמת ביומן הביקורת. אם עדכון כבר רץ מתקבלת שגיאת "עדכון כבר רץ".

**מה קורה מאחורי הקלעים:** ה-API קורא לסוכן עם הסוד המשותף; הסוכן
מריץ `docker compose pull api web workers` ואז `up -d --no-deps`.
ה-API החדש מריץ `prisma migrate deploy` לפני שהוא עולה — סכימה וקוד
מתעדכנים יחד.

**עדכון ידני (גיבוי):**

```bash
cd /srv/metavchim
docker compose -f docker-compose.prod.yml --env-file .env.production pull api web workers
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps api web workers
```

**שינויים מבניים** (קבצי compose/Caddyfile חדשים, שירות חדש): הכפתור
לא מכסה אותם — `git pull` על השרת ואז `up -d`. עדכון הסוכן עצמו:
`pull updater && up -d updater`.

**חזרה לגרסה קודמת:** כל דחיפה מתויגת גם ב-SHA —
`IMAGE_TAG=<sha> docker compose ... up -d --no-deps api web workers`.

## תפעול

```bash
# לוגים
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production logs updater

# גיבוי DB יומי (הוסיפו ל-cron של השרת)
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U metavchim metavchim | gzip > /srv/backups/metavchim-$(date +%F).sql.gz
```

## הערות אבטחה

- הסוכן מאזין רק ברשת הפנימית של compose; אין לו פורט חשוף לאינטרנט,
  וכל בקשה דורשת סוד ‎24+ תווים בהשוואה קבועת-זמן.
- ה-API מתחבר עם `metavchim_app` (תחת RLS מלא); מיגרציות בלבד רצות עם
  תפקיד הבעלים.
- `.env.production` לעולם לא נכנס לגיט (מוחרג ב-.gitignore).
