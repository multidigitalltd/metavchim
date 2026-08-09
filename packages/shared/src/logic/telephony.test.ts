import { describe, expect, it } from "vitest";
import {
  TELEPHONY_PROVIDERS,
  callAction,
  describeCall,
  incomingCallTitle,
  parseTelephonyEvent,
  telephonyProvider,
  type TelephonyEvent,
} from "./telephony.js";

function event(overrides: Partial<TelephonyEvent> = {}): TelephonyEvent {
  return {
    type: "ended",
    direction: "inbound",
    peerPhone: "+972501234567",
    providerCallId: "abc",
    ...overrides,
  };
}

describe("parseTelephonyEvent", () => {
  it("מזהה שיחה נכנסת בשמות השדות המקובלים", () => {
    const parsed = parseTelephonyEvent({
      caller: "050-123-4567",
      call_id: "x1",
      status: "ringing",
    });
    expect(parsed).toMatchObject({
      type: "ringing",
      direction: "inbound",
      // הצורה הקנונית של המערכת (E.164) — אותה צורה שממנה נגזר
      // phone_hash, ולכן שיחה נכנסת מוצאת את איש הקשר הקיים
      peerPhone: "+972501234567",
      providerCallId: "x1",
    });
  });

  it("מקבל שמות שדות חלופיים של ספקים שונים", () => {
    const parsed = parseTelephonyEvent({ from: "0521111111", uniqueid: 77, event: "hangup", billsec: "42" });
    expect(parsed?.providerCallId).toBe("77");
    expect(parsed?.durationSeconds).toBe(42);
    expect(parsed?.type).toBe("ended");
  });

  it("בלי מספר אין אירוע — אי אפשר לשייך לאיש קשר", () => {
    expect(parseTelephonyEvent({ call_id: "x1", status: "ringing" })).toBeNull();
  });

  it("בלי מזהה שיחה אין אירוע — כל ניסיון חוזר היה נרשם שוב", () => {
    expect(parseTelephonyEvent({ caller: "0501234567" })).toBeNull();
  });

  it("מספר לא תקין נדחה ולא נרשם כמחרוזת ריקה", () => {
    expect(parseTelephonyEvent({ caller: "חסוי", call_id: "x1" })).toBeNull();
  });

  it("מזהה שיחה יוצאת", () => {
    expect(parseTelephonyEvent({ caller: "0501234567", call_id: "x", direction: "outbound" })?.direction).toBe(
      "outbound",
    );
  });

  it("סיום באורך אפס הוא שיחה שלא נענתה — המשך מכריע על שם הסטטוס", () => {
    const parsed = parseTelephonyEvent({ caller: "0501234567", call_id: "x", status: "hangup", duration: "0" });
    expect(parsed?.type).toBe("missed");
  });

  it("מנרמל את המספר לצורה אחת", () => {
    const a = parseTelephonyEvent({ caller: "+972501234567", call_id: "1" });
    const b = parseTelephonyEvent({ caller: "050-123-4567", call_id: "2" });
    expect(a?.peerPhone).toBe(b?.peerPhone);
  });
});

describe("callAction", () => {
  it("צלצול מקפיץ התראה ולא רושם שיחה", () => {
    expect(callAction(event({ type: "ringing" }), true)).toEqual({
      logCall: false,
      notify: true,
      createLead: false,
    });
  });

  it("סיום רושם שיחה ולא מתריע — התראה אחרי שהשיחה נגמרה חסרת ערך", () => {
    expect(callAction(event({ type: "ended" }), true)).toEqual({
      logCall: true,
      notify: false,
      createLead: false,
    });
  });

  it("שיחה שלא נענתה כן נרשמת — היא מידע על הלקוח", () => {
    expect(callAction(event({ type: "missed" }), true).logCall).toBe(true);
  });

  it("מספר לא מוכר שדיבר איתנו פותח ליד", () => {
    expect(callAction(event({ type: "ended" }), false).createLead).toBe(true);
  });

  it("מספר לא מוכר שלא נענה לא פותח ליד — טעויות חיוג ומוקדנים", () => {
    expect(callAction(event({ type: "missed" }), false).createLead).toBe(false);
  });

  it("שיחה יוצאת לא פותחת ליד גם למספר לא מוכר", () => {
    expect(callAction(event({ type: "ended", direction: "outbound" }), false).createLead).toBe(false);
  });

  it("צלצול יוצא לא מתריע למתווך על עצמו", () => {
    expect(callAction(event({ type: "ringing", direction: "outbound" }), true).notify).toBe(false);
  });
});

describe("incomingCallTitle", () => {
  it("לקוח מוכר מוצג בשמו", () => {
    expect(incomingCallTitle("דנה לוי", "0501234567")).toContain("דנה לוי");
  });

  it("מספר לא מוכר מוצג כמספר", () => {
    expect(incomingCallTitle(null, "0501234567")).toContain("0501234567");
  });
});

describe("describeCall", () => {
  it("שיחה שנענתה מציגה משך", () => {
    expect(describeCall(event({ durationSeconds: 125 }))).toBe("שיחה נכנסת · 2 דק׳ 5 שנ׳");
  });

  it("פחות מדקה", () => {
    expect(describeCall(event({ durationSeconds: 20 }))).toBe("שיחה נכנסת · 20 שנ׳");
  });

  it("שיחה שלא נענתה מנוסחת לפי הכיוון", () => {
    expect(describeCall(event({ type: "missed" }))).toBe("שיחה נכנסת שלא נענתה");
    expect(describeCall(event({ type: "missed", direction: "outbound" }))).toBe(
      "שיחה יוצאת ללא מענה",
    );
  });

  it("בלי משך לא ממציא מספר", () => {
    expect(describeCall(event({ durationSeconds: undefined }))).toBe("שיחה נכנסת");
  });
});

describe("רשימת הספקים", () => {
  it("כל ספק ניתן לאיתור לפי המזהה שלו", () => {
    for (const provider of TELEPHONY_PROVIDERS) {
      expect(telephonyProvider(provider.id)).toBe(provider);
    }
  });

  it("ספק לא מוכר מחזיר undefined ולא קורס", () => {
    expect(telephonyProvider("לא-קיים")).toBeUndefined();
  });

  it("הספק הגנרי לא דורש שום שדה — חיבור בדקה", () => {
    expect(telephonyProvider("generic")?.fields).toEqual([]);
  });

  it("ספק שתומך בחיוג יוצא מגדיר שלוחה", () => {
    for (const provider of TELEPHONY_PROVIDERS.filter((p) => p.clickToDial)) {
      expect(provider.fields.length).toBeGreaterThan(0);
    }
  });
});

describe("בחירת הצד השני לפי הכיוון", () => {
  it("בשיחה נכנסת הלקוח הוא המקור", () => {
    const parsed = parseTelephonyEvent({
      caller: "0501234567",
      to: "037654321",
      call_id: "x",
      direction: "inbound",
    });
    expect(parsed?.peerPhone).toBe("+972501234567");
  });

  it("בשיחה יוצאת הלקוח הוא היעד ולא מספר המשרד", () => {
    // בלי זה כל שיחה יוצאת הייתה נתלית על מספר המשרד עצמו
    const parsed = parseTelephonyEvent({
      caller: "037654321",
      to: "0501234567",
      call_id: "x",
      direction: "outbound",
    });
    expect(parsed?.peerPhone).toBe("+972501234567");
  });

  it("כשיש רק שדה אחד הוא נבחר בכל כיוון", () => {
    expect(parseTelephonyEvent({ to: "0501234567", call_id: "x", direction: "inbound" })?.peerPhone).toBe(
      "+972501234567",
    );
    expect(parseTelephonyEvent({ caller: "0501234567", call_id: "x", direction: "outbound" })?.peerPhone).toBe(
      "+972501234567",
    );
  });

  it("היעד לא נשאר גם כשלוחה — הוא כבר שימש לזיהוי הלקוח", () => {
    const parsed = parseTelephonyEvent({
      caller: "037654321",
      to: "0501234567",
      call_id: "x",
      direction: "outbound",
    });
    expect(parsed?.extension).toBeUndefined();
  });
});

describe("ולידציה של המספר", () => {
  it("מספר קצר מדי נדחה — אחרת היה נפתח לו כרטיס לקוח וליד", () => {
    expect(parseTelephonyEvent({ caller: "123", call_id: "x" })).toBeNull();
  });

  it("מספר ארוך מדי נדחה", () => {
    expect(parseTelephonyEvent({ caller: "05012345678901", call_id: "x" })).toBeNull();
  });

  it("מספר ישראלי תקין מתקבל — נייד וקווי", () => {
    expect(parseTelephonyEvent({ caller: "0501234567", call_id: "x" })?.peerPhone).toBe("+972501234567");
    expect(parseTelephonyEvent({ caller: "037654321", call_id: "x" })?.peerPhone).toBe("+97237654321");
  });
});
