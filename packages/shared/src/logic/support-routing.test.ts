import { describe, expect, it } from "vitest";
import {
  autoReplyReason,
  formatSupportReference,
  inboundDestination,
  referenceFromSubject,
  subjectWithReference,
  supportFromAddress,
} from "./support-routing.js";

describe("לאן הודעה נכנסת הולכת", () => {
  it("טוקן של שרשור תמיכה ⟵ המשך השרשור", () => {
    expect(inboundDestination({ supportThread: true, tenantToken: false })).toEqual({
      kind: "support_thread",
    });
  });

  it("טוקן של תשובת לקוח ⟵ תיבת המשרד", () => {
    expect(inboundDestination({ supportThread: false, tenantToken: true })).toEqual({
      kind: "tenant_reply",
    });
  });

  it("בלי טוקן מוכר ⟵ פנייה חדשה לתמיכה, וזה כל השינוי", () => {
    /*
     * הכלל הישן היה "לא מוכר ⟵ נזרק". זו הייתה ההתנהגות הנכונה
     * כשלכל זרם הייתה כתובת משלו; בתיבה כללית זו בדיוק הפנייה
     * הראשונה של מי שכותב אלינו.
     */
    expect(inboundDestination({ supportThread: false, tenantToken: false })).toEqual({
      kind: "support_new",
    });
  });

  it("טוקן שמוכר בשני המקומות נזרק ואינו מנוחש", () => {
    /*
     * אין כאן ברירה נכונה: ניחוש לכיוון אחד מדליף תשובה פרטית של
     * לקוח לשולחן התמיכה, ולכיוון השני שותל הודעת תמיכה בתיבה של
     * משרד. עדיף שורת יומן ואדם.
     */
    const result = inboundDestination({ supportThread: true, tenantToken: true });
    expect(result.kind).toBe("drop");
    expect(result.kind === "drop" ? result.reason : "").toContain("גם");
  });
});

describe("מה לא פותח פנייה", () => {
  const human = { subject: "שאלה על החשבונית", headers: [], fromEmail: "dana@office.co.il" };

  it("מייל של אדם פותח פנייה", () => {
    expect(autoReplyReason(human)).toBeNull();
  });

  it("מעטפת שולח ריקה היא הודעת מערכת", () => {
    // התקן דורש `<>` בדיוק כדי שלא יהיה למי להשיב
    expect(autoReplyReason({ ...human, returnPath: "<>" })).not.toBeNull();
  });

  it("מעטפה שהספק לא מסר אינה נחשבת ריקה", () => {
    expect(autoReplyReason({ ...human, returnPath: undefined })).toBeNull();
    expect(autoReplyReason({ ...human, returnPath: "  " })).toBeNull();
  });

  it("כותרות מענה אוטומטי", () => {
    for (const header of [
      { name: "Auto-Submitted", value: "auto-replied" },
      { name: "auto-submitted", value: "auto-generated" },
      { name: "X-Autoreply", value: "yes" },
      { name: "X-Autorespond", value: "1" },
      { name: "Precedence", value: "auto_reply" },
      { name: "X-Failed-Recipients", value: "a@b.c" },
    ]) {
      expect(autoReplyReason({ ...human, headers: [header] }), header.name).not.toBeNull();
    }
  });

  it("‏Auto-Submitted: no פירושו מפורשות שאדם שלח", () => {
    expect(
      autoReplyReason({ ...human, headers: [{ name: "Auto-Submitted", value: "no" }] }),
    ).toBeNull();
  });

  it("‏Precedence: bulk לבדו אינו מספיק", () => {
    /*
     * רשימת דיוור מסומנת `bulk`, ולקוח שכותב מרשימה כזו הוא עדיין
     * לקוח. רק `auto_reply` הוא מענה אוטומטי.
     */
    expect(
      autoReplyReason({ ...human, headers: [{ name: "Precedence", value: "bulk" }] }),
    ).toBeNull();
  });

  it("נושאים של מחוץ-למשרד ואי-מסירה", () => {
    for (const subject of [
      "Automatic reply: שאלה",
      "Out of Office",
      "Undeliverable: הצעה",
      "Delivery Status Notification (Failure)",
      "מחוץ למשרד עד יום ראשון",
      "הודעה אוטומטית",
    ]) {
      expect(autoReplyReason({ ...human, subject }), subject).not.toBeNull();
    }
  });

  it("„auto” בתוך משפט אינו נושא של מענה אוטומטי", () => {
    // העוגן בתחילת המחרוזת קיים בדיוק בשביל זה
    expect(autoReplyReason({ ...human, subject: "בעיה עם auto: בהגדרות" })).toBeNull();
    expect(autoReplyReason({ ...human, subject: "שאלה על out of office במערכת" })).toBeNull();
  });

  it("שולחים שהם תמיד מכונה", () => {
    for (const from of [
      "mailer-daemon@example.com",
      "postmaster@example.com",
      "noreply@vendor.com",
      "no-reply@vendor.com",
      "donotreply@vendor.com",
    ]) {
      expect(autoReplyReason({ ...human, fromEmail: from }), from).not.toBeNull();
    }
  });

  it("שם שרק מכיל „reply” אינו מכונה", () => {
    expect(autoReplyReason({ ...human, fromEmail: "replies@office.co.il" })).toBeNull();
    expect(autoReplyReason({ ...human, fromEmail: "noreplyman@office.co.il" })).toBeNull();
  });
});

describe("מספר הפנייה", () => {
  it("מוצג עם סולמית", () => {
    expect(formatSupportReference(1042)).toBe("#1042");
  });

  it("בלי מספר — מקף, לא „#undefined”", () => {
    expect(formatSupportReference(null)).toBe("—");
    expect(formatSupportReference(undefined)).toBe("—");
    expect(formatSupportReference(0)).toBe("—");
  });

  it("נדבק לנושא, ולא פעמיים", () => {
    expect(subjectWithReference("שאלה", 7)).toBe("[#7] שאלה");
    expect(subjectWithReference("[#7] שאלה", 7)).toBe("[#7] שאלה");
  });

  it("חוזר מהנושא — רשת הביטחון למי שפתח מייל חדש", () => {
    expect(referenceFromSubject("Re: [#1042] שאלה")).toBe(1042);
    expect(referenceFromSubject("שאלה בלי מספר")).toBeNull();
    expect(referenceFromSubject("[#0] שאלה")).toBeNull();
  });

  it("הזוג סוגר מעגל", () => {
    expect(referenceFromSubject(subjectWithReference("שאלה על החשבונית", 993))).toBe(993);
  });
});

describe("מאיזו כתובת יוצא דואר התמיכה", () => {
  const GLOBAL = "no_reply@metavchim.co.il";
  const POSTMARK = "abc123def@inbound.postmarkapp.com";

  it("כתובת השירות מנצחת — זה מה שהמשתמש הגדיר", () => {
    /*
     * המקרה שהוליד את התיקון: כתובת שירות מוגדרת, כתובת הקליטה היא
     * נתיב של Postmark, והתשובות יצאו מ-`no_reply`.
     */
    expect(
      supportFromAddress({
        supportEmail: "service@metavchim.co.il",
        inboundAddress: POSTMARK,
        globalFrom: GLOBAL,
      }),
    ).toBe("service@metavchim.co.il");
  });

  it("גם כשהקליטה כלל לא הוגדרה", () => {
    // „מאיפה זה יוצא” אינה שאלה על הקליטה
    expect(
      supportFromAddress({
        supportEmail: "service@metavchim.co.il",
        inboundAddress: null,
        globalFrom: GLOBAL,
      }),
    ).toBe("service@metavchim.co.il");
  });

  it("דומיין שאינו מאומת נדחה — שליחה שנכשלת גרועה משורת „מאת” לא אידיאלית", () => {
    expect(
      supportFromAddress({
        supportEmail: "service@example.com",
        inboundAddress: POSTMARK,
        globalFrom: GLOBAL,
      }),
    ).toBeNull();
  });

  it("נתיב קליטה של הספק אינו שולח, גם ככתובת שירות", () => {
    expect(
      supportFromAddress({
        supportEmail: POSTMARK,
        inboundAddress: POSTMARK,
        globalFrom: GLOBAL,
      }),
    ).toBeNull();
  });

  it("בלי כתובת שירות — כתובת קליטה שהיא תיבה אמיתית", () => {
    /*
     * משרד שהגדיר דומיין משלו ואימת אותו ממשיך לשלוח ממנו, גם אם
     * הוא אינו הדומיין של השולח הכללי.
     */
    expect(
      supportFromAddress({
        supportEmail: "",
        inboundAddress: "tmicha@office.co.il",
        globalFrom: GLOBAL,
      }),
    ).toBe("tmicha@office.co.il");
  });

  it("אין כלום — נשארים עם השולח הכללי", () => {
    expect(
      supportFromAddress({ supportEmail: null, inboundAddress: null, globalFrom: GLOBAL }),
    ).toBeNull();
    expect(
      supportFromAddress({ supportEmail: "service@x.co.il", inboundAddress: null, globalFrom: "" }),
    ).toBeNull();
  });

  it("רווחים ואותיות גדולות אינם משנים את ההכרעה", () => {
    expect(
      supportFromAddress({
        supportEmail: "  Service@Metavchim.CO.IL  ",
        inboundAddress: POSTMARK,
        globalFrom: "no_reply@metavchim.co.il",
      }),
    ).toBe("Service@Metavchim.CO.IL");
  });
});
