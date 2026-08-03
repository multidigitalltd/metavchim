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

## גיבוי ושחזור

**גיבוי אוטומטי מובנה** — שירות `backup` שרץ עם המערכת:

- **מסד נתונים:** `pg_dump -Fc` (דחוס) כל 24 שעות, נשמר
  `BACKUP_KEEP_DAYS` ימים (ברירת מחדל 14).
- **תמונות (MinIO):** ארכיון `tar.gz` פעם בשבוע (יום ראשון), נשמר
  `BACKUP_MEDIA_KEEP_DAYS` ימים (ברירת מחדל 28).
- הקבצים נכתבים ל-`BACKUP_DIR` במארח (ברירת מחדל
  `/srv/metavchim/backups`), והגיבוי הראשון רץ מיד בעליית השירות —
  קל לוודא שהמנגנון חי: `ls -lh backups/`.

**עותק מחוץ לשרת (מובנה):** גיבוי על אותו שרת לא מגן מקריסת דיסק או
מחיקת השרת — שירות `offsite` מסנכרן את הגיבויים לאחסון ענן תואם-S3
כל 6 שעות. הפעלה:

1. פתחו חשבון באחסון תואם-S3 — מומלץ
   [Backblaze B2](https://www.backblaze.com/cloud-storage) (10GB חינם,
   ואז ~$6/TB לחודש) או Cloudflare R2. צרו Bucket **פרטי** ומפתח גישה.
2. ב-`.env.production`: הוסיפו `offsite` ל-`COMPOSE_PROFILES`
   (למשל `COMPOSE_PROFILES=offsite`, או `standalone,offsite` בשרת
   ייעודי) ומלאו את `OFFSITE_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY`.
3. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`
   ואימות בלוג: `docker compose ... logs offsite` — אמור להופיע
   `✓ סונכרן`.

השחזור מגיבוי חיצוני: מורידים את הקובץ חזרה לתיקיית הגיבויים
(דרך ממשק הספק או `rclone copy`) וממשיכים בנוהל השחזור הרגיל למטה.

**שחזור מסד נתונים** (עוצר את האפליקציה, משחזר, מעלה חזרה).
הפקודות מניחות את ברירת המחדל `BACKUP_DIR=./backups`; אם שיניתם —
החליפו את הנתיב בהתאם:

```bash
cd /srv/metavchim
docker compose -f docker-compose.prod.yml --env-file .env.production stop api workers
cat backups/db_2026-07-30_0300.dump | \
  docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_restore -U metavchim -d metavchim --clean --if-exists
docker compose -f docker-compose.prod.yml --env-file .env.production start api workers
```

**שחזור תמונות** (הניקוי עם `find` מוחק גם קבצים נסתרים כמו
`.minio.sys` — כך ה-volume משוחזר בדיוק למצב הגיבוי):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production stop minio
docker run --rm -v metavchim_miniodata:/data -v /srv/metavchim/backups:/backups alpine \
  sh -c "find /data -mindepth 1 -delete && tar xzf /backups/media_<תאריך>.tar.gz -C /data"
docker compose -f docker-compose.prod.yml --env-file .env.production start minio
```

הערה: גיבוי המדיה השבועי הוא tar על volume חי — העלאה שרצה בדיוק
ברגע הגיבוי עלולה להיתפס חלקית (חלון קטן — הריצה בשעת לילה, והארכיון
עצמו מאומת בשלמותו). כשנדרש גיבוי מדיה עקבי-לחלוטין (למשל לפני
שדרוג מסוכן), עצרו רגעית את minio, הריצו את ה-tar ידנית באותה תבנית
כמו בפקודת השחזור, והעלו חזרה.

## תמלול מקומי (הקלטות שלא יוצאות מהשרת)

הפיצ'ר הקולי עובד כברירת מחדל עם זיהוי הדיבור של הדפדפן. הפעלת
שירות ה-STT מחליפה אותו בתמלול על השרת: **איכות עברית גבוהה בהרבה,
עובד בכל דפדפן, וההקלטה לא נשלחת לשום גורם חיצוני** — היא מתומללת
מקומית ונמחקת מיד (לא נכתבת לדיסק קבוע ולא נשמרת בגיבויים).

### דרישות משאבים

| רכיב | ברירת מחדל | הערות |
|------|------------|-------|
| מודל | `ivrit-ai/whisper-large-v3-turbo-ct2` | Whisper turbo מכוונן לעברית |
| RAM | ~2GB (int8) | תקרה קשיחה: `STT_MEMORY_LIMIT` (ברירת מחדל 3g) |
| דיסק | ~1.5GB | המודל נמשך פעם אחת ל-volume |
| CPU | 2 threads | `STT_THREADS`; שאר הליבות נשארות למערכת |
| מהירות | הקלטה של 30 שנ' ≈ 5–15 שנ' | תלוי במעבד |

תמלול אחד רץ בכל רגע (`STT_CONCURRENCY`) — כך שהתמלול לא חונק את
שאר המערכת. בשרת 8GB עם כל שאר השירותים זה עובד; לנפחים גדולים
(עשרות משרדים) מומלץ להעביר את השירות למכונה נפרדת.

### הפעלה

```bash
cd /srv/metavchim
# 1) סוד משותף בין ה-API לשירות התמלול
echo "STT_SECRET=$(openssl rand -hex 24)" >> .env.production
echo "STT_URL=http://stt:9000" >> .env.production
# 2) הוספת הפרופיל (בשורת COMPOSE_PROFILES הקיימת — למשל: offsite,stt)
nano .env.production
# 3) בנייה והרמה — המשיכה הראשונה של המודל לוקחת כמה דקות.
#    ה-API עולה מחדש כדי לקלוט את STT_URL/STT_SECRET החדשים —
#    בלעדיו הוא ימשיך לדווח שהתמלול אינו זמין.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build stt api
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f stt
```

בלוג אמור להופיע `Application startup complete`, ומיד אחריו
`טוען מודל תמלול` — השירות מושך את המודל ברקע כבר בעלייה (כמה
דקות בפעם הראשונה), כדי שההקלטה הראשונה של המתווך לא תחכה לו.
כשמופיע `המודל נטען` הכול מוכן; אפשר לוודא גם עם
`docker compose -f docker-compose.prod.yml --env-file .env.production exec stt \
python -c "import urllib.request,json;print(json.load(urllib.request.urlopen('http://127.0.0.1:9000/health')))"`
— השדה `loaded` צריך להיות `true`.

הבדיקה האמיתית: במסך 🎤 קול תראו את הכיתוב "התמלול מתבצע על השרת
שלכם", והטקסט מופיע תוך כדי הדיבור.

### קצב התמלול החי — ולמה הוא מתאים את עצמו

ההקלטה נחתכת להפסקות טבעיות של הדובר וכל קטע מתומלל בנפרד, כך
שהטקסט מצטבר תוך כדי במקום להופיע רק בסוף. אורך הקטע **לא קבוע**:
השרת מודד את זמן העיבוד בפועל (`avgSeconds` ב-`/health`) והממשק
גוזר ממנו קטע ארוך ב-25% — בין 8 ל-25 שניות.

הסיבה נוגדת אינטואיציה: Whisper מקודד תמיד חלון של 30 שניות, גם
עבור קטע של 3 שניות. לכן העלות לבקשה כמעט קבועה, וקטעים קצרים
*לא* מזרזים את התמלול אלא שוברים אותו — כל אחד עולה כמעט אותו זמן,
והפיגור מצטבר עד שהטקסט מגיע אחרי שהדובר סיים. שרת מהיר יותר מקבל
אוטומטית קטעים קצרים וטקסט חי יותר, בלי שינוי בקוד.

לראות את המספר בפועל:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 20 stt | grep תומלל
```

שורה כמו `תומלל 18.0s אודיו ב-7.4s (ממוצע 7.6s)` אומרת שהשרת מתמלל
פי 2.4 ממהירות הדיבור — מצוין. אם הממוצע מתקרב ל-25 שניות, כדאי
להעלות את `STT_THREADS` או לשדרג את השרת.

**כיבוי:** מוחקים את `STT_URL` מהקובץ ומריצים
`up -d api` (הרמת ה-API מחדש) — הממשק חוזר אוטומטית לזיהוי של
הדפדפן, בלי שגיאות.

## התחברות עם Google

מוגדרת מהמסך **/platform ⟵ חיבורי המערכת**, בלי SSH. ההגדרה משותפת
לכל המשרדים בפלטפורמה.

**עיקרון שחשוב להבין לפני ההפעלה: אין הרשמה עצמית.** Google מוכיח
בעלות על כתובת אימייל — הוא לא מקנה גישה. משתמש חייב להיות כבר קיים
במשרד (הוזמן בידי מנהל), אחרת הכניסה נדחית בהודעה ברורה. בלי הכלל
הזה כל בעל חשבון Google היה יכול ליצור לעצמו גישה למערכת רב-דיירית.

### הקמה ב-Google Cloud Console

1. **APIs & Services ⟵ OAuth consent screen** — סוג External, ממלאים
   שם אפליקציה ואימייל תמיכה.
2. **Credentials ⟵ Create credentials ⟵ OAuth client ID**, סוג
   **Web application**.
3. תחת **Authorized redirect URIs** מוסיפים בדיוק:
   `https://<הדומיין שלכם>/api/v1/auth/google/callback`
   (הכתובת המדויקת מוצגת גם במסך /platform — אפשר להעתיק משם).
4. מעתיקים Client ID ו-Client Secret אל /platform ⟵ חיבורי המערכת ⟵
   התחברות עם Google, ושומרים.

הכפתור "התחברות עם Google" מופיע במסך הכניסה מיד לאחר מכן. לא הוגדר ⇒
הכפתור לא מוצג והמסלול חסום.

**משתמש שהוזמן וטרם החליף סיסמה זמנית:** כניסה עם Google מוכיחה בעלות
על הכתובת, ולכן היא מבטלת את הסיסמה הזמנית לגמרי (שלא תישאר דלת פתוחה
שמנהל המשרד מכיר) ומכניסה ישירות. אם ירצה גם סיסמה — "שכחתי סיסמה".

## מוניטורינג — לדעת על תקלה לפני שהלקוח מתקשר

למערכת שני נתיבי בדיקה ציבוריים (ללא נתוני לקוחות):

- `/api/v1/health` — התהליך חי (משמש את ה-healthcheck הפנימי של docker).
- `/api/v1/health/deep` — בדיקת אמת: גם מסד הנתונים עונה. מחזיר 503
  כשהמערכת לא באמת מתפקדת. **זה הנתיב לניטור חיצוני.**

הקמה עם [UptimeRobot](https://uptimerobot.com) (חינם, 5 דקות):

1. הרשמה ⟵ New Monitor ⟵ סוג HTTP(s).
2. URL: ‏`https://<הדומיין>/api/v1/health/deep`.
3. Interval: ‏5 דקות; Alert contacts: האימייל שלכם (ואפשר גם אפליקציית
   UptimeRobot לנייד להתראות push).

מרגע זה: המערכת לא עונה או שה-DB נפל ⟵ התראה תוך דקות, מנקודת מבט
חיצונית אמיתית (תופס גם שרת שקרס לגמרי, DNS שבור או תעודה שפגה —
דברים ששום בדיקה מתוך השרת לא תתפוס).

## תפעול

```bash
# לוגים
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production logs updater
docker compose -f docker-compose.prod.yml --env-file .env.production logs backup
```

## הערות אבטחה

- הסוכן מאזין רק ברשת הפנימית של compose; אין לו פורט חשוף לאינטרנט,
  וכל בקשה דורשת סוד ‎24+ תווים בהשוואה קבועת-זמן.
- ה-API מתחבר עם `metavchim_app` (תחת RLS מלא); מיגרציות בלבד רצות עם
  תפקיד הבעלים.
- `.env.production` לעולם לא נכנס לגיט (מוחרג ב-.gitignore).
