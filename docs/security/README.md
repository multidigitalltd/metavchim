# סקירת אבטחה ותקינות — משימות תיקון

הסקירה נערכה ב־8 באוקטובר 2026 על `multidigitalltd/metavchim`, בענף `claude/secure-modular-system-design-k3guzk`, בקומיט `64284f43679509e08d0d0dc86dbfbc1379c23204`.

[משימת המעקב #639](https://github.com/multidigitalltd/metavchim/issues/639) מרכזת את הטיפול. [מסמך המסירה ל־Claude](CLAUDE-HANDOFF.md) כולל סדר עבודה, כללי אימות ונוסח מוכן להעברה ל־Claude Code/Claude בענן.

## משימות

| משימה | עדיפות טיפול | נושא |
| --- | --- | --- |
| [SEC-01 · #640](https://github.com/multidigitalltd/metavchim/issues/640) | P1 | לסגור הסלמת הרשאות פלטפורמה, האצלת תפקידים ופרצות מחזור ההתחברות |
| [SEC-02 · #641](https://github.com/multidigitalltd/metavchim/issues/641) | P1 | להשלים מחיקת מידע אישי ולבטל קישורי intake לאחר מחיקת איש קשר |
| [SEC-03 · #642](https://github.com/multidigitalltd/metavchim/issues/642) | P1 | לאכוף בעלות והרשאות מודולים בשיתוף קונים, קשרים ושליחת Gmail |
| [SEC-04 · #643](https://github.com/multidigitalltd/metavchim/issues/643) | P1 | למנוע יצירת קרדיטים במחזורי הפניות ובמענק התחלה מקביל |
| [SEC-05 · #644](https://github.com/multidigitalltd/metavchim/issues/644) | P1 | לקשור מחיר למסלול, לצרוך קופון אטומית ולשמר כל תקופה ששולמה |
| [SEC-06 · #645](https://github.com/multidigitalltd/metavchim/issues/645) | P1 | לתקן RLS בזיכוי תשלום ולהוסיף התאוששות בטוחה לכשלים וחידושים |
| [SEC-07 · #646](https://github.com/multidigitalltd/metavchim/issues/646) | P2 | לחזק גבולות אינטגרציה: סכימות AI, סנכרון Gmail, יעדי Push ופרסור אודיו |
| [SEC-08 · #647](https://github.com/multidigitalltd/metavchim/issues/647) | P1 | לתקן סודות בפריסה, אמינות גיבוי, נעילות updater ובטיחות שחזור מדיה |
| [SEC-09 · #648](https://github.com/multidigitalltd/metavchim/issues/648) | P1 | לעדכן תלויות פגיעות ולהרחיב את שערי שרשרת האספקה בלי לעקוף אימות |

P1/P2 מציינות עדיפות טיפול; חומרת כל ממצא, תנאיו ורמת הראיות מפורטים במשימה. בכל Issue יש הפניות לקוד בקומיט שנבדק, תנאי קבלה ובדיקות נדרשות. משימות אלו עדיין פתוחות ואינן אישור שהתיקונים בוצעו.

## מצב המסירה והאימות

המשימות מסומנות בתוויות `security-review`, `claude` ותווית עדיפות. בבדיקת GitHub לא נמצא Claude כגורם שניתן לשייך אליו Issue, ולכן אין שיוך או הפעלה אוטומטיים. יש להעביר את משימת המעקב והמסמך ל־Claude בחיבור שבו עובדים על המאגר.

בסקירה עברו build, lint, typecheck, 3,582 בדיקות יחידה ו־56 בדיקות אינטגרציה. נבדקו גם API, אחסון, worker ודפדפן. סריקת תלויות מצאה advisories שדורשים טיפול ב־SEC-09; הצלחת הבדיקות האחרות אינה הוכחה שהממצאים תוקנו. החשד ל־CSP nonce נשלל.

זהו תיעוד תיקון ציבורי. הדוח הפנימי המפורט ותרחישי שחזור רגישים אינם כלולים בו. לא בוצעו חיובים או פעולות אצל ספקי ייצור, וכל טענה מותנית או בדיקה עם ספק מדומה מסומנת בהתאם במשימות.
