# הקמת השרת כקוד

ההקמה של `app.metavchim.co.il` — בפקודה אחת במקום רצף פקודות שאדם
מקליד לפי מסמך.

## מה זה פותר

`docs/10-deployment.md` תיאר את ההקמה נכון, אבל השאיר שתי שאלות בלי
תשובה: כמה זמן לוקח לשחזר שרת שנמחק, ומה בדיוק שונה בשרת מאז שהוקם.
ה-Playbook עונה על שתיהן — הוא מריץ את הרצף בעצמו, והוא **עצמו**
הרישום של מה שנעשה. שינוי בתצורה הוא פול-ריקווסט, לא זיכרון של מי
שהתחבר ב-SSH.

## מה נשאר ידני, ולמה

**הקצאת המכונה אצל ספק הענן.** זו פעולה חד-פעמית שנעשית בממשק של
הספק, ואוטומציה שלה (Terraform) הייתה מוסיפה תלות בספק ובמפתחות
ה-API שלו כדי לחסוך פעולה שקורית פעם בשנים. מה שנדרש מהמכונה:

- Ubuntu 24.04, 2GB RAM ומעלה
- רשומת A מ-`app.metavchim.co.il` ל-IP שלה
- גישת SSH עם מפתח

## הקבצים

| קובץ | מה בו |
| --- | --- |
| `site.yml` | ה-Playbook עצמו |
| `inventory.example.ini` | תבנית המלאי — העתיקו ל-`inventory.ini` |
| `group_vars/all.example.yml` | משתנים שאינם סוד — העתיקו ל-`all.yml` |
| `templates/env.production.j2` | ממנו נוצר `.env.production` בשרת |

`inventory.ini`, `group_vars/all.yml` ו-`group_vars/vault.yml` **אינם
בגיט**. הראשון מכיל כתובת של שרת ייצור, והשלישי מכיל את מפתח ההצפנה
של נתוני הלקוחות.

## הסודות

בקובץ `group_vars/vault.yml`, מוצפן:

```bash
ansible-vault create group_vars/vault.yml
```

תוכן:

```yaml
db_owner_password: <openssl rand -base64 32>
app_db_password: <openssl rand -base64 32>
s3_secret_key: <openssl rand -base64 32>
data_encryption_key: <openssl rand -base64 32>
phone_hash_key: <openssl rand -hex 24>
update_secret: <openssl rand -hex 24>

# רק אם הדלקתם את הפרופיל המתאים — ראו הטבלה למטה
# stt_secret: <openssl rand -hex 24>
# hf_token: <טוקן קריאה מ-huggingface.co/settings/tokens>
# offsite_s3_endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# offsite_s3_bucket: metavchim-backups
# offsite_s3_access_key: <מספק האחסון>
# offsite_s3_secret_key: <מספק האחסון>
```

`data_encryption_key` הוא המפתח שבו מוצפנים שמות, טלפונים ואימיילים
של כל הלקוחות במערכת. **אובדן שלו פירושו אובדן הנתונים** — גיבוי של
המסד בלי המפתח אינו שווה דבר. שמרו עותק מחוץ לשרת ומחוץ לריפו.

סיסמאות המסד עוברות `urlencode` בתבנית, ולכן `openssl rand -base64`
בטוח למרות ש-`/` ו-`+` שכיחים בפלט שלו. בלי הקידוד סיסמה עם `/`
הייתה נקראת כתחילת נתיב בכתובת החיבור ו-Prisma היה דוחה אותה.

### פרופילי רשות

מי שמדליק פרופיל ב-`compose_profiles` חייב להוסיף גם את המשתנים
שלו לכספת. ה-Playbook נופל בבדיקה מקדימה אם חסר משהו — פרופיל שעולה
בלי המשתנים שלו הוא שירות שנופל בלולאה בזמן שהפריסה מדווחת הצלחה,
כי בדיקת העומק מכסה את הליבה בלבד.

| פרופיל | מה נדרש |
| --- | --- |
| `stt` | `stt_secret` |
| `diarize` | `hf_token` (וגם `stt` דלוק) |
| `offsite` | `offsite_s3_endpoint`, `offsite_s3_bucket`, `offsite_s3_access_key`, `offsite_s3_secret_key` |

## הרצה

```bash
cp inventory.example.ini inventory.ini            # ומלאו כתובת
cp group_vars/all.example.yml group_vars/all.yml  # ומלאו דומיין
ansible-playbook -i inventory.ini site.yml --ask-vault-pass
```

הרצה חוזרת בטוחה ואינה משביתה כלום: כל משימה אידמפוטנטית, ומה שכבר
במצב הנכון מדווח `ok` ולא `changed`. זו גם הדרך לפרוס גרסה — לא רק
להקים מאפס.

לבדיקה בלי לשנות דבר:

```bash
ansible-playbook -i inventory.ini site.yml --ask-vault-pass --check --diff
```

## סדר שאסור להפוך

תפקיד האפליקציה (`metavchim_app`) חייב להיווצר **לפני** שהמיגרציות
רצות: חלק מהן מפנות אליו ב-`GRANT`/`REVOKE` ונופלות אם אינו קיים.
בפריסה הזו זה קורה מעצמו — `infra/postgres/init-app-role.sh` רץ
בעליית המסד הראשונה, לפני שה-API עולה ומריץ מיגרציות. אין מה לעשות
ידנית, אבל כן כדאי לדעת: אם המסד הורם פעם אחת בלי `APP_DB_PASSWORD`,
התפקיד לא נוצר וההרצה הבאה תיכשל על מיגרציה ולא על חוסר בסוד.

## מה נבדק בכל בנייה

- `pnpm verify:iac` — כל מפתח ב-`.env.production.example` קיים גם
  בתבנית, ולהפך. מפתח שנשכח בתבנית פירושו שירות שעולה בלי המשתנה,
  וזה נכשל בשקט ולא ברעש. מפתחות של פרופילי רשות נבדקים בנפרד:
  בתבנית הם בתוך `{% raw %}{% if %}{% endraw %}` ובדוגמה כשורת
  הערה, וגם עליהם נדרש שיהיו מתועדים.
- `ansible-playbook --syntax-check` — ה-Playbook נטען ומתפרש.

מה ש**אינו** נבדק בבנייה: ההרצה עצמה מול שרת. אין לנו שרת חד-פעמי
ב-CI, ולכן שינוי במשימה עצמה נבדק בהרצה עם `--check` מול הייצור לפני
המיזוג.
