import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * הגבול של חדר העסקה — נאכף מבנית, ולא בהבטחה בתיעוד.
 *
 * ## הכלל שהחדר עומד עליו
 *
 * שני משרדים שנפגשו ברשת מקבלים סביבה משותפת: פרטי הסוכנים, כתובת
 * הנכס, שרשור ושלבים. **הלקוחות נשארים אצל מי שהביא אותם** — הקונה
 * אצל המשרד שגייס אותו והמוכר אצל המשרד שהחתים אותו. משרד שמקבל
 * את הטלפון של הקונה של עמיתו כבר אינו שותף אלא מחליף, וכל הרשת
 * עומדת על כך שזה לא יקרה.
 *
 * הבדיקות כאן קוראות את הקוד עצמו ואת המיגרציה, כמו יתר השערים
 * המבניים במאגר (`rls-access`, `auth-coverage`, `feature-coverage`).
 * הסיבה זהה: תגובת API שנבדקת בבדיקה אחת אינה מונעת מהשדה הבא
 * להיווסף מחר, והשדה הבא הוא זה שדולף.
 */

const SERVICE = readFileSync(
  join(import.meta.dirname, "deal-room.service.ts"),
  "utf8",
);

const MIGRATION = readFileSync(
  join(
    import.meta.dirname,
    "../../../prisma/migrations/20260820090000_coop_deal_room/migration.sql",
  ),
  "utf8",
);

describe("חדר העסקה אינו חושף לקוחות", () => {
  /*
   * `contact` הוא הטבלה שבה יושבים השם, הטלפון והאימייל של הלקוח.
   * נגיעה בה מתוך החדר היא בדיוק הדליפה שהכלל בא למנוע — ולכן
   * הבדיקה על שם הטבלה ולא על שם שדה מסוים: שדה חדש שייווסף לה
   * מחר יהיה חשוף אף הוא.
   */
  it("אינו ניגש לטבלת אנשי הקשר כלל", () => {
    expect(SERVICE).not.toMatch(/tx\.contact\b/u);
    expect(SERVICE).not.toMatch(/tx\.contactPhone\b/u);
  });

  it("אינו שולף שם או טלפון בשליפת הקונה", () => {
    const buyerCard = SERVICE.slice(
      SERVICE.indexOf("private async buyerCard"),
      SERVICE.indexOf("/** השרשור."),
    );
    expect(buyerCard).not.toContain("contact");
    expect(buyerCard).not.toContain("phone");
    expect(buyerCard).not.toContain("name");
  });

  /*
   * הצד השני של אותו מטבע: פרטי **הסוכן** דווקא כן נחשפים, וזה
   * מה שהופך חיבור לשיחה. חדר בלי טלפון הוא חדר שממשיכים אחריו
   * בוואטסאפ — כלומר בדיוק המצב שהחדר בא לתקן.
   */
  it("כן חושף את פרטי הסוכן שמנגד", () => {
    expect(SERVICE).toContain("agentPhone");
    expect(SERVICE).toContain("agentEmail");
  });

  /*
   * הכתובת המדויקת היא ההבטחה שכתובה בסכימה על `CoopOffer` —
   * "כתובת מלאה רק אחרי אישור חיבור". היא מתקיימת כאן ורק כאן.
   */
  it("חושף את כתובת הנכס — ההבטחה שבסכימה", () => {
    expect(SERVICE).toContain("street");
    expect(SERVICE).toContain("houseNumber");
  });
});

describe("בידוד ה-RLS של החדר", () => {
  it("קריאה וכתיבה פתוחות לשני הצדדים בלבד", () => {
    for (const policy of [
      "coop_deal_select",
      "coop_deal_insert",
      "coop_deal_update",
      "coop_deal_delete",
    ]) {
      expect(MIGRATION).toContain(policy);
    }
    expect(MIGRATION).toContain("FORCE ROW LEVEL SECURITY");
  });

  /*
   * השרשור הוא Append-Only, כמו יומן הביקורת. משרד שיכול לערוך
   * למפרע מה שהצד השני כבר קרא הופך את החדר מרישום להצעה — ושני
   * משרדים שחולקים עמלה נשענים על הרישום הזה.
   */
  it("אין דרך לערוך הודעה שכבר נכתבה", () => {
    expect(MIGRATION).not.toContain("coop_deal_message_update");
    expect(MIGRATION).toContain("REVOKE UPDATE ON coop_deal_messages");
  });

  /*
   * הגישה לשרשור נגזרת מהחדר ולא מ-`tenant_id` שעל השורה: שם יושב
   * מי **כתב**, ופוליסה שמשווה אליו הייתה מראה לכל צד רק את מה
   * שהוא עצמו כתב — כלומר שרשור שאינו שרשור.
   */
  it("הגישה לשרשור נגזרת מהחדר", () => {
    const select = MIGRATION.slice(
      MIGRATION.indexOf("CREATE POLICY coop_deal_message_select"),
      MIGRATION.indexOf("CREATE POLICY coop_deal_message_insert"),
    );
    expect(select).toContain("FROM coop_deals d");
    expect(select).toContain("listing_tenant_id");
    expect(select).toContain("buyer_tenant_id");
  });

  /*
   * חיבור אחד = חדר אחד. בלי האילוץ, לחיצה כפולה על "מעניין" הייתה
   * פותחת שני חדרים לאותה עסקה ושני המשרדים היו מנהלים אותה בשני
   * מקומות בלי לדעת.
   */
  it("אילוץ ייחודיות על מקור החיבור", () => {
    expect(MIGRATION).toContain("CREATE UNIQUE INDEX coop_deals_origin");
  });
});

describe("שני כיווני הרשת פותחים חדר", () => {
  const collaboration = readFileSync(
    join(import.meta.dirname, "collaboration.service.ts"),
    "utf8",
  );
  const listings = readFileSync(
    join(import.meta.dirname, "listings.service.ts"),
    "utf8",
  );

  /*
   * הרשת דו-כיוונית, וחדר שנפתח רק בכיוון אחד היה משאיר את מחצית
   * השותפים עם אותו מבוי סתום שהיה כאן קודם.
   */
  it("אישור הצעת נכס פותח חדר", () => {
    expect(collaboration).toContain("this.dealRoom.openFromOffer(id)");
  });

  it("אישור פניית קונה פותח חדר", () => {
    expect(listings).toContain("this.dealRoom.openFromInterest(id)");
  });

  /*
   * דחייה אינה פותחת דבר. בלי התנאי המפורש, "לא מתאים" היה פותח
   * חדר משותף עם משרד שהרגע אמר לא.
   */
  it("דחייה אינה פותחת חדר", () => {
    for (const source of [collaboration, listings]) {
      expect(source).toContain('if (response !== "interested")');
    }
  });
});
