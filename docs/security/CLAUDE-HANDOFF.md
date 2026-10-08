# העברת תיקוני אבטחה ותקינות ל־Claude

מאגר: `multidigitalltd/metavchim`; ענף שנסקר: `claude/secure-modular-system-design-k3guzk`; קומיט בסיס: `64284f43679509e08d0d0dc86dbfbc1379c23204`. תאריך סקירה: 8 באוקטובר 2026.

מטרת המסמך היא הנחיות עבודה ותנאי סיום לתיקון. תווית `claude` היא סימון להעברת עבודה בלבד; היא אינה assignee ואינה מפעילה ריצת Claude. בבדיקת GitHub ב־8 באוקטובר 2026 לא נמצא Claude בין ה־actors הניתנים לשיוך ולא נמצא workflow פעיל שלו. ההפעלה/השיוך דורשים חיבור Claude נתמך; אין עדיין ריצת תיקון שנפתחה דרך מסמך זה. [משימת המעקב המרכזית #639](https://github.com/multidigitalltd/metavchim/issues/639) מרכזת את תשע משימות הטיפול. דוח האבטחה המפורט ותרחישי השימוש לרעה נשארים מחוץ למאגר הציבורי.

## נוסח להעברה ל־Claude Code או Claude בענן

```text
קרא את docs/security/CLAUDE-HANDOFF.md ואת משימת המעקב:
https://github.com/multidigitalltd/metavchim/issues/639

טפל במשימות SEC-01 עד SEC-09 המקושרות שם, לפי סדר העדיפויות במסמך.
השווה ל-HEAD ולמצב המשימות לפני שינוי, כי הסקירה נעולה לקומיט
64284f43679509e08d0d0dc86dbfbc1379c23204.

לכל שינוי, אמת את הממצא, הוסף בדיקת התנהגות שכשלה לפני התיקון ועוברת אחריו,
ופתח PR ממוקד שמפנה למשימה ומפרט את האימות והמגבלות שנותרו.
הרץ בדיקות מסד עם תפקיד אפליקציה מוגבל ושמור את הגנות RLS, TLS והרשאות.
אל תבצע פעולות ספק או ייצור לצורך הבדיקות; השתמש בספקים מדומים ובנתונים סינתטיים.
עדכן את המשימות רק לפי תוצאות מאומתות. תווית claude לבדה אינה מעידה על תחילת עבודה.
```

## מפת המשימות

| משימה | עדיפות | טיפול |
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

## סדר עבודה ותנאי סיום

- [ ] SEC-01: קודם זהות מנהל, גבולות האצלת יכולות ו־guard של platform; אחר כך OTP/session lifecycle.
- [ ] SEC-02 ו־SEC-03: מחיקת PII וקישורים ציבוריים, והרשאות בעלות/מודולים לפני פרסום ושליחה.
- [ ] SEC-06: הקשר RLS לזיכוי תשלום, state machine ו־reconciliation לפני כל retry לתוצאה לא ידועה.
- [ ] SEC-04 ו־SEC-05: invariants של ledger, provenance, קופונים ומחיר scoped; אין לאבד תקופה ששולמה.
- [ ] SEC-08 ו־SEC-09: סודות, recovery, פריסה עקבית ושערי תלויות. יש לתאם stack אודיו עם SEC-07.
- [ ] SEC-07: סכימות AI, מיזוג תחת נעילה, Gmail ללא אובדן cursor, Push ו־multipart לפני parsing.
- [ ] לכל תיקון: בדיקת regression התנהגותית שכשלה לפני ועברה אחרי, והפניה לממצא/Issue ב־PR.

להשתמש ב־checkout הקיים בסביבה המבודדת. להשוות את הקוד העדכני לקומיט הבסיס לפני מימוש; לא להניח שעדיין יש אותו פגם אם כבר תוקן. לחלק PRs לפי שינוי שניתן לבדוק בנפרד ולשמור את ההפניות לממצאים.

## כללי אימות

הסקירה שילבה סקירת קוד, מתודות מקוריות/פלט מהודר עם ספקים מדומים, מסד PostgreSQL אמיתי תחת תפקיד אפליקציה שאינו superuser/BYPASSRLS, HTTP ודפדפן. רמת הראיה מפורטת בכל Issue. ספקי תשלום/דואר/WhatsApp/OAuth/תמלול אמיתיים לא נבדקו; לא בוצעו חיובים, החזרים או משלוחים חיצוניים.

בסיס ההרצות עבר: build, typecheck, lint, 3,582 בדיקות יחידה, 56 בדיקות אינטגרציה, API/worker וזרימת התחברות/נכס בדפדפן. audit מצא advisories אמיתיים וחסם כשורה. הבדיקות הקיימות כוללות שערי AST ואינן מוכיחות invariants עסקיים או מרוצים; יש להוסיף בדיקות התנהגות ומסד נדרשות, בלי להפחית assertions.

לשמור FORCE RLS, תפקיד מסד מוגבל, append-only ledgers/audit, TLS, package signatures/checksums ומגבלות capabilities/blocked modules. בדיקות חיוב ו־Gmail יהיו עם ספק מדומה ונתונים סינתטיים; sandbox ספק יופעל רק כשיש הרשאה וערכים מתאימים. סודות לא יישמרו ב־Git, ב־Issue, בתסריט או בלוג. אין להפעיל restore/update או לכתוב על נתוני ייצור לצורך regression.

בדיקות התאמה אחרי השינויים: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm --filter @metavchim/api test:rls`, `pnpm test:audit-script`, `pnpm verify:audit`, והבדיקות הממוקדות שמפורטות במשימה. יש להכין Prisma client ומיגרציות במסד בדיקה לפני integration; תפקיד owner משמש רק למיגרציות ו־fixture setup/cleanup, לא לטשטוש RLS בהרצת האפליקציה.

## גבולות הסקירה

A1 מותנה בכתובת allowlist פנויה וידועה; הרצת OTP כפולה דורשת קוד תקף; שיתוף/Gmail/related הם פגמי הרשאה בתוך משרד, בלי הוכחת RLS כללית בין משרדים. סיכוני refund/WhatsApp retry וקישור מספר WhatsApp תלויים במדיניות/ספק ודורשים אימות נוסף. דירוגי critical/high של advisories אינם הוכחה לניצול ביישום. מפתחות סינתטיים בלבד שימשו לשחזורי תשתית.

החשד ל־CSP nonce נשלל ב־Chromium ובניתוח pipeline של Next; אין לפתוח אותו מחדש כממצא מאומת ואין להרחיב CSP כדי לתקן אותו. MapLibre SSR logs ו־CSP origins של feature PBX הם סעיפי תקינות/תצורה בעלי עדיפות נמוכה/מותנית.

הפניות קוד נעולות לדוגמה: [זהות מנהל](https://github.com/multidigitalltd/metavchim/blob/64284f43679509e08d0d0dc86dbfbc1379c23204/apps/api/src/common/platform-admin.guard.ts#L37-L49), [מחיקת קשר](https://github.com/multidigitalltd/metavchim/blob/64284f43679509e08d0d0dc86dbfbc1379c23204/apps/api/src/modules/contacts/contact-erasure.service.ts#L461-L683), [claim וזיכוי](https://github.com/multidigitalltd/metavchim/blob/64284f43679509e08d0d0dc86dbfbc1379c23204/apps/api/src/modules/billing/billing.service.ts#L610-L633), [כלכלת קרדיטים](https://github.com/multidigitalltd/metavchim/blob/64284f43679509e08d0d0dc86dbfbc1379c23204/packages/shared/src/logic/credit-economy.ts#L183-L192). ההפניות המלאות ותנאי הקבלה נמצאים ב־Issues.
