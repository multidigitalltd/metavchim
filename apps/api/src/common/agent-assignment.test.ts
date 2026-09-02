import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**„של מי הכרטיס הזה?” — ושלוש הדרכים שבהן התשובה נעלמת בשקט.**
 *
 * הבקשה הייתה של סוכנות עם כמה סוכנים: שכל נכס וכל ליד יהיו משויכים,
 * ושהמנהל יראה בכל כרטיס למי. שלוש הטענות כאן הן מה שקל לשבור בלי
 * שדבר ייראה שבור:
 *
 * 1. ‎**השם נשלף לכל שורה.** שליפה בתוך הלולאה עובדת מצוין על שלוש
 *    שורות בבדיקה, ונהיית N+1 בדיוק אצל הסוכנות עם מאה נכסים —
 *    כלומר אצל מי שהשדה נבנה בשבילו.
 * 2. ‎**כתיבה בלי אימות משרד.** הבורר מציג את אנשי המשרד, אבל בקשה
 *    ישירה ל-API אינה עוברת דרכו, ואפשר לכתוב כל מזהה שהוא.
 * 3. ‎**המסך שוכח דלי.** רשימה שלא מציגה סוכן מסתירה בדיוק את
 *    הכרטיסים שהמנהל מחפש — אלה שאין להם.
 *
 * הבדיקה קוראת קוד ולא מריצה אותו: שלושתן טענות על **צורה** —
 * שאילתה מקובצת, קריאה לשומר, ורכיב שמופיע בשישה מסכים.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const API = (path: string): string => read(new URL(`../modules/${path}`, import.meta.url));
const WEB = (path: string): string =>
  read(new URL(`../../../web/src/app/${path}`, import.meta.url));

describe("שיוך סוכן — נכס, ליד וקונה", () => {
  /**
   * ‎**ארגומנטים של כל קריאה ל-`agentNames`, לא „איפשהו בקובץ”.**
   *
   * חיפוש טקסט חופשי בקובץ שלם עונה „כן” גם כשהקריאה הנכונה נמחקה,
   * כי משהו אחר בקובץ מספק את התבנית. לכן כאן נשלפים הארגומנטים של
   * כל קריאה בנפרד — עם איזון סוגריים, כי `TenantContext.current()`
   * מכיל סוגריים משלו — והטענה היא על **הצורה של הארגומנט השלישי**.
   */
  const agentNamesArgs = (src: string): string[] => {
    const out: string[] = [];
    const call = /agentNames\(/gu;
    for (let m = call.exec(src); m !== null; m = call.exec(src)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i += 1) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") depth -= 1;
      }
      out.push(src.slice(m.index + m[0].length, i - 1));
    }
    return out;
  };

  /** הארגומנט השלישי — מה שממנו נגזרים המזהים. */
  const idsArg = (args: string): string => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < args.length; i += 1) {
      const ch = args[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (ch === "," && depth === 0) {
        parts.push(args.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(args.slice(start));
    return (parts[2] ?? "").trim();
  };

  /*
   * ‎`agentNames` מקבלת מערך מזהים ומחזירה מפה, ולכן יש בדיוק שתי
   * צורות תקינות להזין אותה: **עמוד שלם ממופה** (רשימה), או
   * ‎**שורה אחת** (כרטיס). כל צורה שלישית — למשל מזהה של השורה
   * הראשונה בלבד, או שליפה בתוך הלולאה — היא בדיוק ה-N+1 או
   * ה„רק הראשון מקבל שם” שהפונקציה נועדה למנוע.
   */
  const PAGE = /^[A-Za-z][\w.]*\.map\(\((row|r)\) => \1\.\w+\)$/u;
  const SINGLE = /^\[(row|r)\.\w+\]$/u;

  it.each([
    ["properties/properties.service.ts", "רשימת הנכסים"],
    ["leads/leads.service.ts", "רשימת הלידים"],
    ["buyers/buyers.service.ts", "רשימת הקונים"],
  ])("%s — שם הסוכן נשלף בשאילתה מקובצת", (path) => {
    const ids = agentNamesArgs(API(path)).map(idsArg);
    expect(ids.length, "אין קריאה ל-agentNames").toBeGreaterThan(0);

    /* אין צורה שלישית */
    for (const arg of ids) {
      expect(PAGE.test(arg) || SINGLE.test(arg), `ארגומנט שאינו עמוד ואינו שורה: ${arg}`).toBe(
        true,
      );
    }
    /* לפחות קריאה אחת מקבלת עמוד שלם */
    expect(ids.filter((arg) => PAGE.test(arg)).length, "אין שליפה מקובצת").toBeGreaterThanOrEqual(1);
    /*
     * ‎**ולכל היותר אחת מקבלת שורה בודדת** — זו של הכרטיס. שנייה
     * כזו פירושה שליפה שנכנסה ללולאה של רשימה, כלומר N+1.
     */
    expect(ids.filter((arg) => SINGLE.test(arg)).length, "יותר משליפת שורה אחת").toBeLessThanOrEqual(
      1,
    );
  });

  /*
   * ‎**כתיבה שאינה מאמתת משרד.** ל-`agentUserId` יש שני נתיבי כתיבה
   * בנכס — יצירה ועדכון — ושניהם חייבים לעבור בשומר. בלעדיו אפשר
   * לשייך נכס לכל מזהה, כולל של משרד אחר.
   */
  it("שני נתיבי הכתיבה של שיוך הנכס עוברים באימות משרד", () => {
    const src = API("properties/properties.service.ts");
    const guards = [...src.matchAll(/assertAgentInOffice\(/gu)];
    expect(guards.length, "פחות משני שומרים").toBeGreaterThanOrEqual(2);
    /* והשומר עצמו באמת שואל את המסד על המשרד */
    const helper = read(new URL("./agent-names.ts", import.meta.url));
    expect(helper).toMatch(/where: \{ tenantId, id: agentUserId \}/u);
    expect(helper).toMatch(/BadRequestException/u);
  });

  /*
   * ‎**שישה מסכים, תשובה אחת.** שלושת הכרטיסים ושלוש הרשימות. מסך
   * שנשמט מהרשימה הזו הוא בדיוק המסך שבו המנהל לא יידע של מי הכרטיס.
   */
  it.each([
    "properties/[id]/page.tsx",
    "properties/page.tsx",
    "leads/[id]/page.tsx",
    "leads/page.tsx",
    "buyers/[id]/page.tsx",
    "buyers/page.tsx",
  ])("%s — מציג את הסוכן", (path) => {
    /*
     * ‎**שני רכיבים, טענה אחת.** ארבעה מסכים מציגים `AgentTag`,
     * ובשני הכרטיסים שבהם מנהל גם מעביר יושב `AgentPicker` — שהוא
     * מציג את אותה תגית בעצמו למי שאינו רשאי. מה שנבדק הוא שהמסך
     * מציג את הסוכן, לא באיזה מהשניים.
     *
     * ‎`toContain` היה עונה „כן” גם על `AgentTagX`, ועל שורת
     * ה-`import` לבדה אחרי שהרכיב הוסר מה-JSX. לכן: **אלמנט**
     * שמקבל את השם מה-DTO.
     */
    expect(WEB(path)).toMatch(
      /<Agent(?:Tag|Picker)(?![A-Za-z0-9_])[\s\S]{0,400}?\.agentName/u,
    );
  });

  /**
   * ‎**הבורר יושב על היכולת של הנתיב שהוא קורא לו.**
   *
   * הרשימה מגיעה מ-`/tasks/assignees`, שדורש `tasks.assign`. גזירתו
   * מ-`properties.edit` נתנה בורר לסוכן ולעוזר — שמחזיקים בשנייה
   * ולא בראשונה — ואז הבקשה חוזרת 403, הרשימה ריקה, והפקד מציע „לא
   * משויך” בלבד: נראה עובד, ואינו יכול לשייך לאיש.
   */
  it.each([["properties/[id]/page.tsx"], ["buyers/[id]/page.tsx"]])(
    "%s — הבורר נגזר מ-tasks.assign ולא מהרשאת עריכה",
    (path) => {
      expect(WEB(path)).toMatch(/const canAssignAgent = can\(user, "tasks\.assign"\)/u);
      expect(WEB(path)).toMatch(/canAssign=\{canAssignAgent\}/u);
    },
  );

  /*
   * ‎**והשליפה עצמה מותנית באותה יכולת.** `/tasks/assignees` דורש
   * ‎`tasks.assign`; בלי התנאי הבקשה חוזרת 403, הרשימה נשארת ריקה,
   * והבורר מציע „לא משויך” בלבד — פקד שנראה עובד ואינו יכול לשייך
   * לאיש.
   */
  it("והרשימה נשלפת רק כשיש את היכולת", () => {
    const picker = WEB("agent-picker.tsx");
    expect(picker).toMatch(/if \(!canAssign\) return;/u);
    expect(picker).toMatch(/if \(!canAssign\) \{\s*return <AgentTag/u);
  });

  /*
   * ‎**„לא משויך” אינו מוצע בקונה.** `ownerUserId` מסנן ראייה
   * ‎(`ownershipFilter`), ו-NULL אינו שווה לאף מזהה — כלומר קונה
   * בלי בעלים אינו „של כולם” אלא **בלתי נראה** לכל סוכן שאין לו
   * ‎`buyers.view_all`. ניתוק היה מעלים את הכרטיס בלי ששום מסך
   * יאמר זאת. בנכס השדה מתעד בלבד, ולכן שם הניתוק מותר.
   */
  it("הקונה אינו ניתן לניתוק, והנכס כן", () => {
    expect(WEB("buyers/[id]/page.tsx")).toMatch(/allowUnassign=\{false\}/u);
    expect(WEB("properties/[id]/page.tsx")).toMatch(/\ballowUnassign\b(?!=)/u);
    /* ‎`allowUnassign` באמת שולט באפשרות ולא רק מועבר כ-prop */
    expect(WEB("agent-picker.tsx")).toMatch(
      /\{allowUnassign \? <option value="">/u,
    );
  });

  /*
   * ‎**העברה נרשמת ביומן — עם שני הצדדים.** „שדה השתנה” אינו אומר
   * לאן, וזו השאלה שנשאלת אחר כך: מי העביר את הכרטיס ומתי.
   */
  it.each([
    ["properties/properties.service.ts", "property.agent_changed"],
    ["buyers/buyers.service.ts", "buyer.agent_changed"],
  ])("%s — ההעברה נרשמת כ-%s", (path, action) => {
    const src = API(path);
    expect(src).toContain("agentHandover(");
    expect(src).toContain(`action: "${action}"`);
    expect(src).toMatch(/metadata: handover/u);
  });

  /**
   * ‎**תווית אחת לכל פקד.** הבורר ישב בתוך ה-`<label>` של הסטטוס:
   * תווית מקוננת, ותווית שמכילה שני פקדים. קורא מסך אינו יודע איזו
   * שייכת לאיזה `select`, ולחיצה על הטקסט מפעילה את הלא נכון.
   *
   * הטענה נמדדת ולא מונחת: התווית **האחרונה שנפתחה** לפני הבורר
   * חייבת להיות שלו. קינון מחדש מחזיר לכאן את תווית הסטטוס.
   */
  it("בורר הסוכן אינו מקונן בתוך תווית אחרת", () => {
    const src = WEB("agent-picker.tsx");
    const own = src.indexOf('<label htmlFor="agent-picker"');
    expect(own, "התווית של הבורר לא נמצאה").toBeGreaterThan(-1);
    /*
     * ‎**עומק ולא שכנות.** „התווית הקרובה ביותר היא שלו” עובר גם
     * כשתווית הסטטוס נשארה פתוחה מסביבו — כלומר בדיוק על הקינון
     * שהטענה הזו קיימת בשבילו. ספירת הפתיחות מול הסגירות עד לנקודה
     * הזו חייבת להתאזן: עומק 0 פירושו „אף תווית אינה פתוחה כאן”.
     */
    const before = src.slice(0, own);
    const opens = (before.match(/<label[\s>]/gu) ?? []).length;
    const closes = (before.match(/<\/label>/gu) ?? []).length;
    expect(opens - closes, "הבורר יושב בתוך תווית פתוחה").toBe(0);
  });

  /**
   * ‎**„נוצר בידי המערכת” הוא `null`, לא מחרוזת ריקה.**
   *
   * קליטת מוכר רצה בהקשר משרד עם `userId: ""`. ברירת מחדל ישירה
   * הייתה כותבת `''` לעמודה: המסך מציג „לא משויך” (המפה מסננת
   * מחרוזת ריקה), אבל `agent_user_id IS NULL` אינו מוצא את השורה —
   * שני מקורות אמת על אותה שאלה, ואחד מהם שקט.
   */
  it("יצירה בלי יוצר אנושי אינה כותבת מחרוזת ריקה", () => {
    const src = API("properties/properties.service.ts");
    expect(src).toContain("agentUserId: input.agentUserId ?? creatorUserId()");
    expect(src, "ברירת מחדל ישירה חזרה").not.toMatch(
      /agentUserId: input\.agentUserId \?\? TenantContext\.current\(\)\.userId/u,
    );
    const helper = src.slice(src.indexOf("function creatorUserId("));
    expect(helper).toMatch(/return userId === "" \? null : userId;/u);
  });

  /**
   * ‎**הגבול בשרת, לא במסך.**
   *
   * הבורר נשען על `tasks.assign`, אבל בדיקה בלקוח אינה גבול הרשאה:
   * ‎`PATCH` ישיר אינו עובר דרך המסך כלל. תפקיד `agent` מחזיק
   * ב-`buyers.edit` וב-`properties.edit` ואין לו `tasks.assign`,
   * ולכן בלי האכיפה הזו סוכן היה מעביר כרטיס שלו לכל אדם במשרד —
   * פעולה שהוגדרה כאן כשל מנהל (ביקורת Codex).
   */
  it.each([
    ["properties/properties.service.ts", "נכס"],
    ["buyers/buyers.service.ts", "קונה"],
  ])("%s — העברה נאכפת בשרת ולא רק בבורר", (path) => {
    expect(API(path)).toContain("assertCanAssignAgents()");
  });

  it("והשומר באמת בודק את היכולת וזורק 403", () => {
    const helper = read(new URL("./agent-names.ts", import.meta.url));
    const fn = helper.slice(helper.indexOf("export function assertCanAssignAgents"));
    expect(fn).toMatch(/capabilities\.has\("tasks\.assign"\)/u);
    expect(fn).toContain("ForbiddenException");
  });

  /*
   * ‎**וניתוק הוא גם העברה.** מחרוזת ריקה בנכס מנתקת את השיוך, וזו
   * בדיוק אותה פעולה — שער שחל רק על „העברה למישהו” היה מתיר לסוכן
   * לנתק כרטיס בלי רשות.
   */
  it("גם ניתוק שיוך בנכס נאכף", () => {
    const src = API("properties/properties.service.ts");
    expect(src).toMatch(/if \(agentUserId !== undefined\) \{\s*assertCanAssignAgents\(\);/u);
  });

  /**
   * ‎**מה שנרשם — נקרא.**
   *
   * ‎`from`/`to` הם כל הסיבה שהאירוע נפרד מ-`update`. נקודת הקצה
   * החזירה `supportAdmin` בלבד מתוך ה-`metadata`, ולכן הם נכתבו ולא
   * ניתנו לקריאה: המסך אמר „העברת נכס בין סוכנים” בלי לומר בין מי
   * לבין מי — כלומר בדיוק את השאלה שהאירוע קיים בשבילה.
   */
  it("היומן מחזיר את שמות שני הצדדים", () => {
    const src = read(new URL("../modules/settings/settings.controller.ts", import.meta.url));
    expect(src).toMatch(/handoverId\(r, "from"\)/u);
    expect(src).toMatch(/handoverId\(r, "to"\)/u);
    /*
     * השדה עצמו, ולא תת-מחרוזת: `/agentFrom/` עונה „כן” גם על
     * ‎`agentFromX` — אותה חולשה שכבר נמצאה כאן פעם.
     */
    expect(src).toMatch(/\{ agentFrom: agentName\(from\)! \}/u);
    expect(src).toMatch(/\{ agentTo: agentName\(to\)! \}/u);
    /* ובאותה שאילתת שמות שכבר רצה — לא שאילתה לכל שורה */
    expect(src).toMatch(/\.\.\.rows\.flatMap\(\(r\) => \[handoverId\(r, "from"\), handoverId\(r, "to"\)\]\)/u);
  });

  it("והמסך מציג אותם, ולא רק את שם הפעולה", () => {
    const page = WEB("settings/page.tsx");
    expect(page).toMatch(/agentFrom\?\?\s*"לא משויך"|agentFrom \?\? "לא משויך"/u);
    expect(page).toContain('"property.agent_changed": "העברת נכס בין סוכנים"');
    expect(page).toContain('"buyer.agent_changed": "העברת קונה בין סוכנים"');
  });

  /*
   * ‎**„לא משויך” נראה.** זו ברירת המחדל של הרכיב, והיא מה שהופך
   * כרטיס בלי סוכן לגלוי במקום להיעדר שקט.
   */
  it("„לא משויך” הוא ברירת המחדל ולא צריך לבקש אותו", () => {
    const tag = WEB("agent-tag.tsx");
    expect(tag).toMatch(/showUnassigned = true/u);
    expect(tag).toContain("לא משויך");
  });
});
