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

## שרת עם אתר קיים (nginx כבר תופס 80/443)

אין צורך בשרת נפרד: משאירים את ה-nginx הקיים כשער היחיד ומחברים את
מטווחים דרכו. ה-Web וה-API חשופים תמיד על loopback בלבד
(‏127.0.0.1:8090 ו-8091 — לא נגישים מהאינטרנט), כך שהאתר הקיים לא
מושפע כלל.

1. ב-`.env.production` משנים את `COMPOSE_PROFILES=standalone` ל-
   `COMPOSE_PROFILES=` (ריק) — Caddy לא יעלה ולא יתחרה על הפורטים.
2. מריצים `up -d` כרגיל (צעד 4 למעלה).
3. מוסיפים site ל-nginx — `/etc/nginx/sites-available/metavchim`:

```nginx
server {
    listen 80;
    server_name crm.example.co.il;   # הדומיין מ-.env.production

    client_max_body_size 25m;

    location /api/ {
        proxy_pass http://127.0.0.1:8091;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/metavchim /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
# תעודת HTTPS (certbot מוסיף את ה-443 לבד ומחדש אוטומטית)
certbot --nginx -d crm.example.co.il
```

‏`TRUST_PROXY_HOPS=1` נשאר כמו שהוא — nginx הוא שכבת ה-Proxy היחידה.
כפתור העדכון עובד זהה בשני המצבים (הסוכן לא נוגע בשער הכניסה).

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
