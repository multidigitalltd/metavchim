-- ‎**נתוני שוק — עסקאות מיסוי מקרקעין של כל הארץ (docs/14).**
--
-- ‎**מחוץ ל-RLS ובלי `tenant_id`, במכוון.** זה מידע ציבורי של רשות
-- המסים ולא מידע של משרד: אותה עסקה בחיפה נכונה לכל משרד שמוכר
-- בחיפה, ואין בה שם, טלפון או מזהה של אדם. טבלה תחת RLS הייתה
-- מחייבת עותק לכל משרד — 3.8 מיליון שורות כפול מספר המשרדים.
-- הכתיבה מגיעה רק מסבב הסנכרון בשרת; אין נתיב שכותב לכאן מקלט משתמש.
--
-- ‎**קומפקטי, כי זה הנפח הגדול במסד.** מספרים ולא מחרוזות: היישוב
-- והסוג הם מפתחות לטבלאות קטנות, קבוצת הסוג היא מספר (האינדקס
-- ב-`MARKET_NATURE_GROUPS` — רשימה שמתווספת רק בסופה), ואין עמודות
-- שהמסכים אינם קוראים. ההערכה: ‏~250MB לטבלה ו-~200MB לאינדקסים.
--
-- ‎**לא נכנס לגיבוי היומי** (`infra/backup/run.sh`,
-- ‎`--exclude-table-data='market_*'`): הכול נבנה מחדש מהמקור, וגיבוי
-- שמנפח פי כמה בגלל מידע ציבורי פוגע בזמן השחזור ובמכסת האחסון
-- החיצוני. המבנה כן נשמר, ולכן אחרי שחזור הסנכרון מתחיל מאפס לבד.

-- יישובים כפי שהמקור מפרסם אותם, ומצב הסנכרון של כל אחד.
--
-- המזהה ניתן באפליקציה (MAX+1 תחת נעילת הסנכרון) ולא ב-SEQUENCE: כך
-- נוהגות כל הטבלאות במערכת — אין ערך שהמסד ממציא — ויש כותב אחד בלבד.
CREATE TABLE "market_settlements" (
  "id"                INTEGER       PRIMARY KEY,
  -- השם כפי שפורסם ("תל אביב -יפו") — זה המפתח של המקור
  "name"              VARCHAR(80)   NOT NULL,
  -- סמל יישוב של הלמ"ס, כשהמקור מכיר אותו
  "code"              INTEGER,
  -- כמה עסקאות המקור מדווח ליישוב, ומתי האחרונה — מול זה נמדד הכיסוי
  "source_deals"      INTEGER       NOT NULL DEFAULT 0,
  "source_last_deal"  DATE,
  -- מאיזה תאריך להמשיך את הקליטה הראשונה. NULL = הקליטה הראשונה הושלמה
  "backfill_cursor"   DATE,
  -- העסקה האחרונה שנקלטה; הסנכרון השוטף חוזר ממנה 60 יום אחורה
  "synced_through"    DATE,
  -- pending | backfill | ok | error
  "status"            VARCHAR(12)   NOT NULL DEFAULT 'pending',
  "last_error"        VARCHAR(300),
  "synced_at"         TIMESTAMP(3)
);

CREATE UNIQUE INDEX "market_settlements_name_key" ON "market_settlements"("name");
CREATE INDEX "market_settlements_status_synced_at_idx" ON "market_settlements"("status", "synced_at");

-- 47 הסוגים של המקור, וקבוצת הסוג שלנו לכל אחד (`marketNatureGroup`).
CREATE TABLE "market_natures" (
  "id"           SMALLINT     PRIMARY KEY,
  "name"         VARCHAR(60)  NOT NULL,
  "nature_group" SMALLINT     NOT NULL
);

CREATE UNIQUE INDEX "market_natures_name_key" ON "market_natures"("name");

-- העסקאות עצמן.
--
-- המזהה הוא 8 הבתים הראשונים של SHA-256 על `marketDealKey` — לא ULID,
-- כי למקור אין מזהה, והסנכרון חוזר על אותן עסקאות בכל ריצה. המזהה
-- הדטרמיניסטי הוא מה שהופך את החזרה ל-upsert ולא לכפילות.
CREATE TABLE "market_deals" (
  "id"             BIGINT        PRIMARY KEY,
  "deal_date"      DATE          NOT NULL,
  -- שקלים שלמים, כפי שדווח. BIGINT כי עסקת בניין עוברת 2.1 מיליארד
  "amount_ils"     BIGINT        NOT NULL,
  "settlement_id"  INTEGER       REFERENCES "market_settlements"("id"),
  "nature_id"      SMALLINT      NOT NULL REFERENCES "market_natures"("id"),
  -- עותק של קבוצת הסוג מ-market_natures, כדי שהאינדקס החם יכלול אותה
  "nature_group"   SMALLINT      NOT NULL,
  "area_sqm"       INTEGER,
  "rooms"          NUMERIC(3,1),
  "year_built"     SMALLINT,
  -- החלק שנמכר, 0–1
  "portion"        NUMERIC(4,3),
  -- מחיר למ"ר על החלק שנמכר (`pricePerSqm`)
  "ppsqm"          INTEGER,
  "gush"           INTEGER       NOT NULL,
  "helka"          INTEGER       NOT NULL,
  "sub_parcel"     INTEGER,
  -- MARKET_FLAGS — חלקי, קבלן, חריג... העסקה נשמרת, הדגל מחליט אם נספרת
  "flags"          SMALLINT      NOT NULL DEFAULT 0
);

-- היסטוריית בניין ודירה: גוש + חלקה (+ תת-חלקה), מהחדשה לישנה
CREATE INDEX "market_deals_gush_helka_deal_date_idx"
  ON "market_deals"("gush", "helka", "deal_date" DESC);
-- עסקאות דומות, סטטיסטיקה וחיפוש לפי יישוב
CREATE INDEX "market_deals_settlement_id_nature_group_deal_date_idx"
  ON "market_deals"("settlement_id", "nature_group", "deal_date" DESC);
-- העסקאות האחרונות בכל הארץ, במסך הסטטיסטיקה
CREATE INDEX "market_deals_deal_date_idx" ON "market_deals"("deal_date" DESC);

-- חלקות — מיקום, אזור סטטיסטי ואשכול חברתי-כלכלי, למפה ולהשוואה
-- ברמת השכונה. נמלא בהדרגה מהמקור; חלקה בלי שורה כאן פשוט עוד לא
-- הועשרה, וההשוואה מדלגת לדרגה הבאה.
CREATE TABLE "market_parcels" (
  "gush"           INTEGER          NOT NULL,
  "helka"          INTEGER          NOT NULL,
  "settlement_id"  INTEGER          REFERENCES "market_settlements"("id"),
  "stat_area"      INTEGER,
  "socio_eshkol"   SMALLINT,
  "lat"            DOUBLE PRECISION,
  "lon"            DOUBLE PRECISION,
  "street"         VARCHAR(80),
  -- ok | missing | error
  "status"         VARCHAR(10)      NOT NULL,
  "fetched_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("gush", "helka")
);

CREATE INDEX "market_parcels_settlement_id_idx" ON "market_parcels"("settlement_id");
-- השוואה ברמת השכונה: כל החלקות באותו אזור סטטיסטי
CREATE INDEX "market_parcels_stat_area_idx" ON "market_parcels"("stat_area");

-- סטטיסטיקה מחושבת מראש — חציון ורבעונים לכל סגמנט.
--
-- ‎`settlement_id = 0` = כל הארץ, `room_bucket = 0` = כל הגדלים,
-- ‎`quarter = 0` = השנה כולה. אפסים ולא NULL: מפתח ראשי אינו מקבל NULL,
-- ואפס אינו יישוב, דלי או רבעון אמיתי. אין מפתח זר ליישוב בגלל ה-0.
-- נבנה מחדש ליישוב בכל פעם שהסנכרון נגע בו — המסכים רק קוראים.
CREATE TABLE "market_segment_stats" (
  "settlement_id"   INTEGER   NOT NULL,
  "nature_group"    SMALLINT  NOT NULL,
  "room_bucket"     SMALLINT  NOT NULL,
  "year"            SMALLINT  NOT NULL,
  "quarter"         SMALLINT  NOT NULL,
  "deals"           INTEGER   NOT NULL,
  "new_build_deals" INTEGER   NOT NULL,
  "median_price"    BIGINT,
  "p25_price"       BIGINT,
  "p75_price"       BIGINT,
  "median_ppsqm"    INTEGER,
  "p25_ppsqm"       INTEGER,
  "p75_ppsqm"       INTEGER,
  "median_area"     INTEGER,
  PRIMARY KEY ("settlement_id", "nature_group", "room_bucket", "year", "quarter")
);

-- יומן הסנכרון — מה רץ, כמה, ומה נכשל. מסך הפלטפורמה קורא מכאן.
CREATE TABLE "market_sync_runs" (
  "id"           CHAR(26)      PRIMARY KEY,
  -- auto = הסבב התקופתי · manual = כפתור במסך הפלטפורמה
  "kind"         VARCHAR(12)   NOT NULL,
  "started_at"   TIMESTAMP(3)  NOT NULL,
  "finished_at"  TIMESTAMP(3),
  -- running | ok | partial | error
  "status"       VARCHAR(10)   NOT NULL,
  "requests"     INTEGER       NOT NULL DEFAULT 0,
  "rows"         INTEGER       NOT NULL DEFAULT 0,
  "message"      VARCHAR(500)
);

CREATE INDEX "market_sync_runs_started_at_idx" ON "market_sync_runs"("started_at" DESC);

-- ‎**הנכס של המשרד ↔ החלקה במאגר.**
--
-- ‎`parcel_source` באותו דפוס של `location_source`: מה שאדם הקליד
-- (`agent`, `tabu`) לא נדרס ע"י חישוב (`lookup`). תת-החלקה היא מה
-- שפותח את היסטוריית הדירה עצמה — המחיר שבו הבעלים קנה.
--
-- ‎`market_*` הן צילום של ההשוואה האחרונה: המחיר המבוקש מול השוק,
-- בכמה עסקאות. נשמר כדי שרשימות ותגיות („מתחת לשוק” בהתאמות) יקראו
-- עמודה ולא יריצו השוואה לכל שורה.
ALTER TABLE "properties"
  ADD COLUMN "gush"              INTEGER,
  ADD COLUMN "helka"             INTEGER,
  ADD COLUMN "sub_parcel"        INTEGER,
  ADD COLUMN "parcel_source"     VARCHAR(10),
  ADD COLUMN "market_diff_pct"   SMALLINT,
  ADD COLUMN "market_sample"     SMALLINT,
  ADD COLUMN "market_checked_at" TIMESTAMP(3);
