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

**הסוכן אינו מעדכן את עצמו.** הוא מריץ את פקודת ה-compose מתוך
הקונטיינר שלו, והרמה מחדש של אותו קונטיינר הייתה הורגת את הפקודה
באמצע ומשאירה את השרת בלי סוכן. לכן הוא רק **מושך** את התמונה
החדשה של עצמו בסוף כל עדכון, וההרמה נשארת פעולה ידנית של שורה אחת.

זה מצב שקורה בפועל ושווה להכיר: המערכת חדשה, הסוכן ישן, וכפתור
שנוסף מאז (למשל "גבה עכשיו") מחזיר שגיאה כי הנתיב אינו קיים בסוכן.
ההודעה במסך אומרת את זה מפורשות ומצטטת את הפקודה.

**עדכון ידני (גיבוי) — כולל הסוכן:**

```bash
cd /srv/metavchim && git pull
docker compose -f docker-compose.prod.yml --env-file .env.production pull api web workers updater
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps api web workers updater
```

**שינויים מבניים** (קבצי compose/Caddyfile חדשים, שירות חדש): הכפתור
לא מכסה אותם — `git pull` על השרת ואז `up -d`.

**הריפו לא ב-`/srv/metavchim`?** הוסיפו `REPO_DIR=/הנתיב/שלכם`
ל-`.env.production`. הסוכן מריץ `docker compose` מול ה-Docker של
המארח, ולכן נתיבים יחסיים בקובץ ה-compose (למשל `./backups`) נפתרים
מול המארח — והריפו מחובר לסוכן באותו נתיב מוחלט בדיוק. ערך שגוי
מתבטא בכך שאחרי עדכון מתוך המערכת מסך הגיבויים מופיע ריק בזמן
שהקבצים שלמים על הדיסק.

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

### ניהול הגיבויים מהמסך `/platform`

מנהל הפלטפורמה רואה את מצב הגיבויים בלי SSH, ויכול למחוק ולשחזר משם.
המסך מציג שני חיוויים:

- **גיבוי מקומי** — גיל הדאמפ האחרון של המסד. ירוק עד 30 שעות, כתום
  עד 48, אדום מעליהן או כשאין אף גיבוי. (ארכיון התמונות שבועי ולכן
  אינו משפיע על הצבע.)
- **עותק מחוץ לשרת** — מתי הסתיים הסנכרון האחרון וכמה קבצים יושבים
  ביעד. הנתון מגיע מ-`/state/status.json` שקונטיינר ה-`offsite` כותב
  אחרי כל מחזור; אישורי האחסון עצמם **לא** נחשפים ל-API.

**מחיקה** — זמינה לכל קובץ למעט הדאמפ האחרון של המסד, שמוגן בשרת
(לא רק בממשק). כשהסנכרון החיצוני פעיל, הקובץ המרוחק לא נמחק אלא עובר
ל-`metavchim-archive/<תאריך>/` — כלומר מחיקה מוטעית עדיין ניתנת לשחזור.

**שחזור** — מגיע דרך סוכן העדכון (`infra/updater`), כי הפעולה עוצרת את
ה-API עצמו. הרצף: דאמפ בטיחות אוטומטי של המצב הנוכחי ⟵ עצירת
`api/web/workers` ⟵ `pg_restore` בטרנזקציה אחת ⟵ הרמה מחדש. ההרמה
מובטחת גם כשהשחזור נכשל, וכיוון ש-`pg_restore` רץ ב-`--single-transaction`
כישלון משאיר את המסד בדיוק כפי שהיה. הממשק דורש הקלדת המילה `שחזר`
כאישור.

הפעולה חלה על **כל המשרדים יחד** והמערכת אינה זמינה בזמנה — לכן היא
מוצגת רק למי שמופיע ב-`PLATFORM_ADMIN_EMAILS`.

> שחזור מגיבוי חיצוני: מורידים את הקובץ חזרה לתיקיית הגיבויים
> (`rclone copy` או ממשק הספק), והוא יופיע ברשימה עם כפתור שחזור —
> כל עוד שמו נשאר בתבנית המקורית (`db_…​.dump` / `media_…​.tar.gz`).

### שחזור ידני מהשרת

הנוהל למי שמעדיף שורת פקודה, או כשה-API עצמו לא עולה.

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

### עותק גיבוי מחוץ לשרת — Cloudflare R2

**למה זה לא אופציונלי:** בלי זה הגיבוי יושב על אותה מכונה כמו המערכת.
תקלת דיסק אחת מוחקת את שניהם — כלומר את המאגר של כל המשרדים ואת
הגיבוי שלו יחד.

#### 1. ב-Cloudflare

1. **R2 ⟵ Create bucket** — שם למשל `metavchim-backups`, מיקום
   אוטומטי או אירופה.
2. **R2 ⟵ Manage API Tokens ⟵ Create API Token**, הרשאה
   **Object Read & Write**, ומוגבל לדלי הזה בלבד. טוקן מצומצם לא יוכל
   למחוק דליים אחרים גם אם השרת ייפרץ.
3. מעתיקים **Access Key ID**, **Secret Access Key**, ואת כתובת
   ה-endpoint שמוצגת שם בצורה
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

#### 2. על השרת

```bash
cd /srv/metavchim
cat >> .env.production <<'EOF'
OFFSITE_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
OFFSITE_S3_BUCKET=metavchim-backups
OFFSITE_S3_ACCESS_KEY=<ACCESS_KEY_ID>
OFFSITE_S3_SECRET_KEY=<SECRET_ACCESS_KEY>
EOF
# הוספת הפרופיל לשורת COMPOSE_PROFILES הקיימת
nano .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production up -d offsite
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f offsite
```

בלוג צריך להופיע `סונכרן ✓`. אין צורך להגדיר region או provider —
ברירת המחדל בקומפוז היא כבר R2.

#### מה מגן מפני מחיקה בטעות

`rclone sync` משקף מחיקות, כלומר תיקייה מקומית ריקה הייתה מוחקת גם את
העותק המרוחק — והורסת בדיוק את מה שאמור להציל. שתי הגנות:

1. **בדיקת ריקנות לפני כל סנכרון.** אין קבצים מקומיים ⇒ הסנכרון
   מדולג והשגיאה נרשמת בלוג. הדלי המרוחק לא נוגע.
2. **ארכיון במקום מחיקה.** קובץ שנמחק או הוחלף עובר אל
   `metavchim-archive/<תאריך>` בדלי, ולא נמחק. מחיקה שגויה ניתנת
   לשחזור.

מומלץ להפעיל גם **Object Lifecycle** ב-R2 שימחק את תיקיית הארכיון
אחרי 90 יום, כדי שהעלות לא תטפס.

#### בדיקה שהגיבוי באמת עובד

גיבוי שלא נבדק אינו גיבוי. אחרי הסנכרון הראשון:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  --entrypoint rclone offsite ls offsite:metavchim-backups/metavchim-backups
```

צריכה להופיע רשימת קבצי ה-dump עם גדלים סבירים (עשרות עד מאות MB).

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

## זיהוי דוברים בשיחות טלפון

תמלול של שיחה מוקלטת בלי זיהוי דוברים הוא קיר טקסט אחד שבו אי אפשר
לדעת מי אמר "אני מוכן לשלם 2.4 מיליון" — המתווך או הלקוח. שירות
`diarize` מוסיף לכל משפט תווית דובר וחותמת זמן:

```
[00:00] דובר 1: שלום, מדבר יוסי מהמשרד
[00:03] דובר 2: היי, כן, אני מחפשת שלושה חדרים
```

**חל רק על הקלטות שיחה.** ההכתבה לשדה (המיקרופון שליד כל שדה טקסט)
לא נוגעת בשירות הזה — היא נשארת מהירה כמו שהייתה.

### איך זה בנוי — ולמה לא WhisperX ישירות

WhisperX משייך דוברים ברמת המילה, וזה מדויק יותר — אבל הוא דורש
מודל יישור (wav2vec2) בשפת השיחה, ולעברית אין כזה בערכה שלו.
המחיר היה מעבר ל-`large-v3` הגנרי במקום `ivrit-ai` המכוונן לעברית,
כלומר תמלול פחות טוב כדי לקבל תוויות מדויקות יותר — עסקה גרועה
כשהתוכן עצמו הוא מה שהמתווך קורא.

לכן הפירוק כאן הוא בדיוק זה של WhisperX, בלי שלב היישור:

| שלב | מי עושה | מה מחזיר |
|-----|---------|----------|
| תמלול | `stt` (faster-whisper, מודל עברי) | טקסט + חותמות זמן למשפט |
| זיהוי דוברים | `diarize` (pyannote — אותו מנוע ש-WhisperX משתמש בו) | מקטעי דיבור עם תווית, בלי טקסט |
| חיבור | ה-worker, לפי חפיפה בזמן | תמלול מתויג |

התוצאה: התווית היא לכל משפט ולא לכל מילה — מספיק בהחלט לשיחת טלפון,
בלי לוותר על איכות התמלול בעברית.

### דרישות משאבים

| רכיב | ברירת מחדל | הערות |
|------|------------|-------|
| מודל | `pyannote/speaker-diarization-3.1` | סגור מאחורי אישור תנאים (חינם) |
| RAM | ~2–3GB | תקרה קשיחה: `DIARIZE_MEMORY_LIMIT` (ברירת מחדל 4g) |
| דיסק | ~1GB (torch + מודל) | volume נפרד מ-`stt` |
| CPU | 2 threads | `DIARIZE_THREADS` |
| מהירות | שיחה של 10 דק' ≈ 5–15 דק' | רץ ברקע; המתווך לא ממתין |

### הפעלה

```bash
cd /srv/metavchim
# 1) טוקן קריאה מ-huggingface.co/settings/tokens
echo "HF_TOKEN=hf_xxxxx" >> .env.production
echo "DIARIZE_URL=http://diarize:9001" >> .env.production
# 2) הוספת הפרופיל לצד stt (למשל: offsite,stt,diarize)
nano .env.production
# 3) בנייה והרמה. ה-worker נדרש להרמה מחדש כדי לקלוט את DIARIZE_URL.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build diarize workers
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f diarize
```

**לפני ההרמה חובה לאשר את תנאי שני המודלים** בחשבון ה-Hugging Face
שהטוקן שייך לו — `pyannote/speaker-diarization-3.1` וגם
`pyannote/segmentation-3.0`. שתי תקלות ההקמה נראות מיד ולא בשקט:

| התקלה | איך היא מתבטאת |
|-------|----------------|
| `HF_TOKEN` חסר | הקונטיינר עוצר בעלייה עם הודעה מפורשת בלוג |
| טוקן שגוי או תנאים שלא אושרו | הקונטיינר עולה אך מסומן `unhealthy` ב-`docker compose ps`, ו-`/health` מחזיר 503 עם סיבת הכישלון |

שתיהן תקלות הקמה שהמפעיל חייב לתקן — לא מצבים שמהם השירות מתאושש
לבד. לכן הוא לא מדווח "בריא" ומנסה לטעון מודל כושל בכל שיחה מחדש.

בלוג אמורות להופיע `טוען מודל זיהוי דוברים` ואחריה
`מודל זיהוי הדוברים נטען`. אחרי שיחה מתומללת:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 20 diarize | grep זוהו
```

שורה כמו `זוהו 2 דוברים ב-34 תורים תוך 41.2s` אומרת שהכול עובד.

### כשמשהו לא מסתדר

השירות הזה **לא מפיל תמלול**. אם הוא כבוי, לא מגיב, או לא הצליח
להפריד דוברים — השיחה נשמרת עם התמלול הרגיל, בלי תוויות, והכשל
נרשם בלוג ה-worker (`diarization skipped`) בלבד. זו החלטה מכוונת:
תמלול בלי תוויות שווה הרבה יותר משיחה שנפלה ל"תמלול נכשל".

כשזוהה **דובר אחד בלבד** — הודעה בתא קולי, שיחה שהוקלטה מצד אחד —
התמלול מוצג כטקסט רציף בלי תוויות. "דובר 1" בראש כל שורה כשאין
דובר שני הוא רעש, לא מידע.

**כיבוי:** מוחקים את `DIARIZE_URL` ומריצים `up -d workers`.

## התראות פוש בדפדפן

התראה שקופצת על המסך של המתווך גם כשהמערכת סגורה — ליד חדש, הצעה שנפתחה, תזכורת לפגישה. עובד בכרום, פיירפוקס ואדג'; בספארי ובאייפון רק אחרי הוספת המערכת למסך הבית.

**הפעלה — פעם אחת:**

```bash
npx web-push generate-vapid-keys
```

מוסיפים ל-`.env.production` (שני הקונטיינרים — api ו-workers — קוראים ממנו):

```
VAPID_PUBLIC_KEY=<המפתח הציבורי>
VAPID_PRIVATE_KEY=<המפתח הפרטי>
VAPID_SUBJECT=mailto:support@metavchim.co.il
```

ואז `docker compose -f docker-compose.prod.yml up -d api workers`.

בלי שלושת המשתנים הפיצ'ר כבוי לגמרי, והמסך מציג "טרם הופעלו בשרת" במקום להציע כפתור שייצור מנוי שאי אפשר לשלוח אליו.

**⚠️ החלפת המפתחות מבטלת את כל המנויים הקיימים.** כל המשתמשים יצטרכו להפעיל מחדש מהפרופיל. אין סיבה להחליף אותם אלא אם המפתח הפרטי דלף — שמרו אותם עם שאר הסודות.

**איך זה עובד בפנים**: כל שורת התראה שנכתבת במערכת מסומנת `pushed_at = NULL`, וסורק ב-workers רץ כל 30 שניות ודוחף את מה שטרם נדחף. המשמעות התפעולית — כל מקור התראה מכוסה אוטומטית, כולל כאלה שייכתבו בעתיד, ואם ה-workers היה למטה חצי שעה ההתראות יישלחו כשיחזור (עד גיל 6 שעות; ישן מזה נזרק, כי פוש שמגיע יום אחרי האירוע הוא רעש).

דו"ח הבוקר והסיכום השבועי **אינם** נדחפים במכוון: הם סיכומים בשעה קבועה, ופוש עליהם הוא בדיוק מה שגורם למשתמש לכבות את ההרשאה — ואז גם ההתראות הדחופות לא מגיעות.

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

## ריפו פרטי — מה צריך כדי שהשרת ימשיך להתעדכן

הפיכת הריפו לפרטי שוברת **שני** נתיבים, וכל אחד דורש אישור נפרד:

| נתיב | למה משמש | מה נדרש |
|------|----------|---------|
| `docker compose pull` | משיכת תמונות מ-GHCR — גם כפתור "עדכן גרסה" | `docker login ghcr.io` עם טוקן `read:packages` |
| `git fetch origin` | עדכון קובץ ה-compose וקבצי infra | מפתח פריסה (Deploy Key) לקריאה בלבד |

ה-CI עצמו לא נשבר: `GITHUB_TOKEN` ממשיך לדחוף תמונות גם בריפו פרטי.

### 1. ב-GitHub (בדפדפן)

1. **Settings ⟵ General ⟵ Danger Zone ⟵ Change visibility ⟵ Private.**
2. **חשוב ולא אוטומטי:** התמונות ב-GHCR **לא** הופכות לפרטיות יחד עם
   הריפו. עוברים לעמוד הארגון ⟵ Packages, ולכל אחת מארבע החבילות
   (`metavchim-api`, `-web`, `-workers`, `-updater`) ⟵ Package
   settings ⟵ Change visibility ⟵ Private. בלי השלב הזה הקוד פרטי
   אבל התמונות עדיין פתוחות לכל העולם.

### 2. טוקן למשיכת תמונות

**Settings ⟵ Developer settings ⟵ Personal access tokens ⟵ Tokens
(classic) ⟵ Generate new token.** מסמנים **אך ורק** `read:packages`.

הטוקן נשמר על השרת ב-`~/.docker/config.json` בקידוד base64 (לא
מוצפן) — לכן הרשאת קריאה בלבד היא לא קוסמטיקה: מי שמשיג את הקובץ
לא יוכל לדחוף תמונות או לגעת בקוד.

```bash
# הטוקן לא נשמר בהיסטוריית הפקודות (read -s)
read -s -p "GHCR token: " GHCR_TOKEN; echo
echo "$GHCR_TOKEN" | docker login ghcr.io -u <שם המשתמש בגיטהאב> --password-stdin
unset GHCR_TOKEN

# בדיקה
cd /srv/metavchim && \
docker compose -f docker-compose.prod.yml --env-file .env.production pull api
```

כפתור "עדכן גרסה" ממשיך לעבוד: שירות ה-updater כבר טוען את
`~/.docker` לקריאה בלבד, והקובץ המעודכן נראה לו מיד.

### 3. מפתח פריסה ל-git

```bash
ssh-keygen -t ed25519 -C "metavchim-server" -f /root/.ssh/metavchim_deploy -N ""
cat /root/.ssh/metavchim_deploy.pub
```

את הפלט מדביקים ב-**Settings ⟵ Deploy keys ⟵ Add deploy key**,
**בלי** לסמן "Allow write access". מפתח כזה תקף לריפו הזה בלבד — גם
אם השרת ייפרץ, אין ממנו דרך לשאר החשבון.

```bash
cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/metavchim_deploy
  IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config

cd /srv/metavchim && \
git remote set-url origin git@github.com:multidigitalltd/metavchim.git && \
ssh -o StrictHostKeyChecking=accept-new -T git@github.com; \
git fetch origin main && echo "✓ גישת git עובדת"
```

(השורה של `ssh -T` מחזירה "does not provide shell access" — זו תשובה
תקינה, לא שגיאה.)

### עלות שכדאי לקחת בחשבון

ב-GitHub Free, דקות Actions הן ללא הגבלה בריפו ציבורי ומוגבלות
ל-2,000 דקות בחודש בריפו פרטי. בניית ארבע התמונות בכל מיזוג ל-main
היא הצרכן העיקרי. אם מתקרבים לתקרה — למזג בקבוצות במקום כל שינוי
בנפרד, או לשדרג מסלול.

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
