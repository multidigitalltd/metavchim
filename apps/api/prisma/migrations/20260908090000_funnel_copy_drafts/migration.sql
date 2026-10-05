-- ‎**טיוטות הנוסח לארבעה-עשר השלבים — וכפתור לכל אחת.**
--
-- ‏השלבים נזרעו במיגרציה הקודמת בלי נוסח, ולכן שלב ב׳ לא היה יכול
-- ‏לשלוח דבר גם אם היה קיים. כאן נכנסות הטיוטות, כדי שבעל
-- ‏הפלטפורמה יתקן אותן **במערכת** ולא בקובץ SQL.
--
-- ‎**`enabled` אינו נגע כאן, ובכוונה.** מילוי נוסח אינו הדלקה: כל
-- ‏ארבעה-עשר נשארים כבויים, ושער `funnel-no-send` ממשיך לאכוף
-- ‏שאין במודול בכלל דרך אל ערוץ יוצא. ההדלקה היא החלטה נפרדת,
-- ‏אחרי שהנוסחים אושרו.
--
-- ‎**`whatsapp_template` נשאר ריק** מאותה סיבה מהצד השני: תבנית
-- ‏וואטסאפ חייבת אישור של מטא, ורק בעל החשבון יכול להגיש אותה.
-- ‏ערך מומצא כאן היה נראה מוכן ונדחה בשליחה הראשונה.

-- ‎**כפתור אחד לכל הודעה.**
--
-- ‏הטבלה ידעה נושא, כותרת וגוף — כלומר מייל שיווקי בלי מקום ללחוץ
-- ‏בו. שתי עמודות ולא אחת, כי „מה כתוב על הכפתור” ו„לאן הוא מוביל”
-- ‏נערכים בנפרד: תיקון נוסח אינו אמור לגעת בנתיב.
--
-- ‏הנתיב יחסי ולא כתובת מלאה: המקור (`WEB_ORIGIN`) נקבע בסביבה,
-- ‏וכתובת מלאה שנשמרת בשורה הייתה נשברת בכל העברה בין סביבות.
ALTER TABLE "funnel_stages" ADD COLUMN "cta_label" VARCHAR(60);
ALTER TABLE "funnel_stages" ADD COLUMN "cta_path" VARCHAR(200);

-- ‏הטיוטות עצמן. `{{שם_פרטי}}` ו-`{{שם_המשרד}}` הם המצייני המקום
-- ‏היחידים שמותרים — ראו `FUNNEL_PLACEHOLDERS` בחבילה המשותפת,
-- ‏ושער שבודק שלא הומצא כאן שלישי שאיש לא יחליף.

UPDATE "funnel_stages" SET
  "email_subject" = $copy$נכס אחד, ואתם כבר רואים מה המערכת עושה$copy$,
  "email_heading" = $copy$ברוכים הבאים — נתחיל מדבר אחד$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

החשבון של {{שם_המשרד}} פתוח. אל תנסו להעביר היום את כל המשרד — זה לא הכרחי, וזה גם לא מה שיראה לכם אם המערכת מתאימה.

הדבר היחיד שכדאי לעשות עכשיו הוא להוסיף נכס אחד. מהרגע שהוא בפנים, המערכת כבר מחפשת לו קונים מהמאגר, יודעת לייצר לו דף נחיתה, ומתעדת מי התעניין.

שתי דקות — ואפשר לעצור שם.$copy$,
  "cta_label"     = $copy$הוספת נכס ראשון$copy$,
  "cta_path"      = $copy$/properties/new$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'd0_first_action';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$המסך עדיין ריק — וזה שתי דקות עבודה$copy$,
  "email_heading" = $copy$בואו נוציא את המערכת ממצב ריק$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

נכנסתם אתמול, ועדיין אין נכס במערכת. זה הדבר היחיד שמפריד בין מסך ריק לבין משהו שאפשר לשפוט.

אפשר להוסיף נכס ידנית בשתי דקות, ואפשר להעלות קובץ אקסל קיים ולייבא את כל המאגר בבת אחת — כולל קבצי ייצוא מהמערכות הנפוצות.

אם משהו נתקע, תענו למייל הזה. הוא מגיע לאדם.$copy$,
  "cta_label"     = $copy$ייבוא מאקסל$copy$,
  "cta_path"      = $copy$/import$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'd1_empty_screen';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$יש צעד אחד שממתין לכם במערכת$copy$,
  "email_heading" = $copy$הצעד הבא שלכם$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

המערכת סימנה לכם צעד אחד שממתין. בדרך כלל זה בדיוק ההבדל בין „נרשמתי” לבין „זה עובד בשבילי”.

זה לוקח פחות מדקה, ואחריו מסך הבית מתחיל להראות עבודה אמיתית במקום כותרות ריקות.$copy$,
  "cta_label"     = $copy$למה שממתין$copy$,
  "cta_path"      = $copy$/$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'd3_one_feature';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$עשרים דקות, ואנחנו מסדרים לכם את המערכת$copy$,
  "email_heading" = $copy$רוצים שנעבור על זה יחד?$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

רוב המשרדים שהתחילו לעבוד באמת עשו את זה אחרי שיחה קצרה — לא הדגמה, אלא ישיבה על המערכת שלכם: מה לייבא, מה לכבות, ואיך לחבר את המרכזייה.

עשרים דקות, בזמן שנוח לכם. תענו למייל הזה עם שעה שמתאימה ונחזור אליכם.

ואם אתם מסתדרים לבד — התעלמו מהמייל הזה בשקט. זה בסדר גמור.$copy$,
  "cta_label"     = $copy$המדריכים במערכת$copy$,
  "cta_path"      = $copy$/guides$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'd5_intro_call';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$מה המערכת עשתה אצלכם השבוע$copy$,
  "email_heading" = $copy$זה מה שכבר רץ ברקע$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

מאז שהתחלתם, המערכת עבדה ברקע: התאימה קונים לנכסים, תיעדה שיחות ופניות, ואספה את מי שהתעניין.

שווה להיכנס לדוחות ולראות את זה במספרים — במיוחד את ההתאמות. שם בדרך כלל מוצאים את הקונה שכבר היה במאגר ואף אחד לא זכר אותו.$copy$,
  "cta_label"     = $copy$לדוחות$copy$,
  "cta_path"      = $copy$/reports$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'd8_what_we_did';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$יש חלק במערכת שעוד לא נגעתם בו$copy$,
  "email_heading" = $copy$הדבר שרוב המשרדים מגלים מאוחר מדי$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

יש במערכת יכולת שעדיין לא השתמשתם בה, והיא בדרך כלל זו שמחזירה את העלות: התאמת הקונים שכבר יושבים אצלכם במאגר לנכסים החדשים.

זה לא דורש שום הגדרה. פתחו את מסך ההתאמות ותראו מה המערכת כבר מצאה.$copy$,
  "cta_label"     = $copy$למסך ההתאמות$copy$,
  "cta_path"      = $copy$/matches$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'd11_before_money';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$הנתונים שהזנתם ממתינים — כדאי להחליט$copy$,
  "email_heading" = $copy$מה שכבר בנוי אצלכם$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

בשבועות האחרונים הזנתם נכסים, קונים ופניות. זו עבודה אמיתית, והיא נשארת שלכם.

תקופת הניסיון מתקרבת לסופה ועדיין אין אמצעי תשלום בחשבון. אם אתם ממשיכים — כדאי להסדיר את זה עכשיו, כדי שלא יהיה יום שבו המערכת נעולה באמצע עבודה.

ואם החלטתם שלא — תגידו לנו למה. זה עוזר לנו יותר משאתם חושבים.$copy$,
  "cta_label"     = $copy$הסדרת התשלום$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'd17_data_waiting';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$נשארו יומיים לתקופת הניסיון$copy$,
  "email_heading" = $copy$יומיים, ואז החשבון עובר למצב מוגבל$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

תקופת הניסיון של {{שם_המשרד}} מסתיימת בעוד יומיים, ואין עדיין אמצעי תשלום בחשבון.

הנתונים שלכם לא נמחקים — הם ממשיכים לשבת אצלכם. מה שנסגר היא העבודה היומיומית: הוספת נכסים, ההתאמות, והמרכזייה.

ההסדרה לוקחת דקה.$copy$,
  "cta_label"     = $copy$הסדרת התשלום$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'trial_heads_up';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$תקופת הניסיון הסתיימה היום$copy$,
  "email_heading" = $copy$מה בדיוק נסגר, ומה נשאר$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

תקופת הניסיון של {{שם_המשרד}} הסתיימה היום.

מה שנשאר: כל מה שהזנתם — נכסים, קונים, פניות והיסטוריית השיחות. זה לא נמחק.

מה שנסגר: העבודה השוטפת במערכת. ברגע שיוסדר תשלום הכול חוזר בדיוק איפה שהפסקתם — בלי הקמה מחדש ובלי ייבוא שני.$copy$,
  "cta_label"     = $copy$החזרת הגישה$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'trial_closing';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$המייל האחרון מאיתנו$copy$,
  "email_heading" = $copy$אחרונה, ואז שקט$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

עבר שבוע מאז שתקופת הניסיון הסתיימה ולא שמענו מכם. זה בסדר — לא כל מערכת מתאימה לכל משרד.

זה המייל האחרון שנשלח בנושא. הנתונים שלכם שמורים, ואם תרצו לחזור מתישהו — הכול יהיה שם.

ואם יש דבר אחד שלא עבד ושווה שנדע עליו, תענו למייל הזה בשורה אחת. נקרא.$copy$,
  "cta_label"     = $copy$חזרה למערכת$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'trial_last_call';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$החיוב לא עבר$copy$,
  "email_heading" = $copy$החיוב האחרון נדחה$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

ניסינו לחייב את אמצעי התשלום של {{שם_המשרד}} והחיוב נדחה. זה קורה הרבה — כרטיס שפג תוקפו, מסגרת, או חסימה של הבנק לחיוב מקוון.

החשבון ממשיך לעבוד כרגיל בינתיים. עדכון אמצעי התשלום לוקח דקה.$copy$,
  "cta_label"     = $copy$עדכון אמצעי תשלום$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'pay_failed';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$תזכורת — החיוב עדיין לא עבר$copy$,
  "email_heading" = $copy$ניסינו שוב, ועדיין לא$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

החיוב של {{שם_המשרד}} עדיין לא עבר. אם כבר עדכנתם — התעלמו מהמייל הזה, החיוב הבא ייקח את הפרטים החדשים.

ואם לא, זה הזמן: בעוד יומיים הגישה נסגרת.$copy$,
  "cta_label"     = $copy$עדכון אמצעי תשלום$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'pay_reminder';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$מחר החשבון ננעל$copy$,
  "email_heading" = $copy$זו ההודעה שלפני הנעילה$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

החיוב של {{שם_המשרד}} לא עבר, ומחר החשבון עובר למצב נעול.

הנתונים לא נמחקים ולא הולכים לשום מקום — אבל העבודה השוטפת נעצרת, וזה כולל את המרכזייה ואת ההתאמות.

אם יש בעיה שאנחנו יכולים לעזור לפתור, תענו למייל הזה עוד היום.$copy$,
  "cta_label"     = $copy$עדכון אמצעי תשלום$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'pay_last_day';

UPDATE "funnel_stages" SET
  "email_subject" = $copy$החשבון נעול$copy$,
  "email_heading" = $copy$מה קורה עכשיו$copy$,
  "email_body"    = $copy$שלום {{שם_פרטי}},

החשבון של {{שם_המשרד}} נעול, כי החיוב לא הוסדר.

הנתונים שלכם שמורים במלואם. ברגע שאמצעי התשלום יעודכן הגישה חוזרת מיד, בלי הקמה מחדש.

אם החלטתם לסיים — אין צורך לעשות דבר. ואם תרצו שנמחק את הנתונים לצמיתות, תבקשו ונטפל בזה.$copy$,
  "cta_label"     = $copy$החזרת הגישה$copy$,
  "cta_path"      = $copy$/settings?tab=billing$copy$,
  "updated_at"    = CURRENT_TIMESTAMP
WHERE "key" = 'pay_locked';
