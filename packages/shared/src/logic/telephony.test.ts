import { describe, expect, it } from "vitest";
import {
  TELEPHONY_PROVIDERS,
  callAction,
  callIsFinal,
  callOutcomeOf,
  nextRefusalStreak,
  callSpoke,
  describeCall,
  incomingCallTitle,
  parseTelephonyEvent,
  telephonyProvider,
  type TelephonyEvent,
  build015DialUrl,
  parse015DialResponse,
  PBX015_MAKE_URL,
  safeDiagnosticKeys,
  diagnosticFields,
  EMPTY_FIELD_MARK,
  unmappedFields,
  telephonyParseIssue,
  mergeIntegrationSecrets,
  telephonySecretKeys,
  mergeLegacySecretsIntoConfig,
  sipUriFor,
  phoneFromSipUri,
  softphoneGap,
  softphoneOfficeReady,
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
    expect(callAction(event({ type: "ringing" }), true, false)).toEqual({
      logCall: false,
      notify: true,
      createLead: false,
    });
  });

  it("סיום רושם שיחה ולא מתריע — התראה אחרי שהשיחה נגמרה חסרת ערך", () => {
    expect(callAction(event({ type: "ended" }), true, false)).toEqual({
      logCall: true,
      notify: false,
      createLead: false,
    });
  });

  it("שיחה שלא נענתה כן נרשמת — היא מידע על הלקוח", () => {
    expect(callAction(event({ type: "missed" }), true, false).logCall).toBe(true);
  });

  it("מספר לא מוכר שדיבר איתנו פותח ליד", () => {
    expect(callAction(event({ type: "ended", durationSeconds: 90 }), false, false).createLead).toBe(
      true,
    );
  });

  /*
   * ‎**אירוע ניתוק בלי משך אינו „דיבר איתנו”.**
   *
   * הבדיקה שמעליה נקראה „שדיבר איתנו” ובנתה אירוע בלי משך, ולכן היא
   * אישרה בפועל את ההפך: שכל ניתוק פותח ליד. 015 שולח ניתוק גם על
   * שיחה שאיש לא ענה לה, וזה הליד שנפתח על סמך כלום — ומישהו
   * מתקשר לפיו.
   */
  it("ניתוק בלי משך אינו פותח ליד — אין ראיה שמישהו דיבר", () => {
    expect(callAction(event({ type: "ended" }), false, false).createLead).toBe(false);
  });

  /*
   * ‎**הצד השני של אותה בדיקה.**
   *
   * 015 שולחת `Answer` לפני ה-`Hangup`, וזו אמירה מפורשת שהשיחה
   * נענתה. כשהניתוק מגיע בלי `talktime`, דרישת משך בלבד הייתה
   * מוחקת את הליד ממספר לא מוכר שדיברנו איתו — כלומר הופכת תיקון
   * של תווית שגויה לאובדן רשומה.
   */
  it("ניתוק בלי משך אחרי אירוע מענה כן פותח ליד — המרכזייה אמרה שנענתה", () => {
    expect(callAction(event({ type: "ended" }), false, true).createLead).toBe(true);
  });

  it("מספר לא מוכר שלא נענה לא פותח ליד — טעויות חיוג ומוקדנים", () => {
    expect(callAction(event({ type: "missed" }), false, false).createLead).toBe(false);
  });

  it("שיחה שלא נענתה אינה פותחת ליד גם אחרי אירוע מענה", () => {
    expect(callAction(event({ type: "missed" }), false, true).createLead).toBe(false);
  });

  /*
   * המצב שהתגלה בשטח: סוכן התקשר ללקוח חדש, ובמערכת "לא נרשם
   * כלום". שורת השיחה כן נכתבה — בלי `contactId` ובלי `leadId`,
   * כלומר יתומה ובלתי נראית בכל מסך.
   *
   * שיחה יוצאת שנענתה היא ראיה חזקה יותר לעניין מאשר נכנסת: היא
   * דורשת שהסוכן טרח לחייג.
   */
  it("שיחה יוצאת שנענתה פותחת ליד — הסוכן הציע נכס למישהו", () => {
    expect(
      callAction(event({ type: "ended", direction: "outbound", durationSeconds: 45 }), false, false)
        .createLead,
    ).toBe(true);
  });

  it("חיוג יוצא שנותק בצלצול אינו פותח ליד — טעות חיוג", () => {
    expect(
      callAction(event({ type: "missed", direction: "outbound" }), false, false).createLead,
    ).toBe(false);
  });

  it("שיחה יוצאת ללקוח מוכר אינה פותחת כרטיס שני", () => {
    expect(callAction(event({ type: "ended", direction: "outbound" }), true, false).createLead).toBe(
      false,
    );
  });

  it("צלצול יוצא לא מתריע למתווך על עצמו", () => {
    expect(callAction(event({ type: "ringing", direction: "outbound" }), true, false).notify).toBe(
      false,
    );
  });
});

describe("callOutcomeOf", () => {
  it("משך חיובי הוא ראיה למענה", () => {
    expect(callOutcomeOf(event({ type: "ended", durationSeconds: 30 }), false)).toBe("answered");
  });

  /*
   * זה הבאג מהשטח: „על כל השיחות כתוב נענתה”. ניתוק בלי משך אינו
   * אומר דבר על מענה, ורישומו כ„נענתה” הוא טענה שאיש לא בדק.
   */
  it("ניתוק בלי משך ובלי אירוע מענה הוא „לא ידוע” ולא „נענתה”", () => {
    expect(callOutcomeOf(event({ type: "ended" }), false)).toBe("unknown");
  });

  it("אירוע מענה שנצפה קודם הופך את אותו ניתוק ל„נענתה”", () => {
    expect(callOutcomeOf(event({ type: "ended" }), true)).toBe("answered");
  });

  it("„לא נענתה” נשארת „לא נענתה” גם אחרי אירוע מענה", () => {
    expect(callOutcomeOf(event({ type: "missed" }), true)).toBe("missed");
  });
});

describe("callSpoke", () => {
  /*
   * ‎**הבדיקה קוראת ל-`callSpoke` ישירות בכוונה.**
   *
   * הניסוח הראשון שלי בדק את הכלל הזה דרך `callAction`, ועבר גם
   * כשהכלל נמחק: ‎`createLead` דורש ממילא `type === "ended"`, ולכן
   * אירוע „לא נענתה” לעולם אינו מגיע אל הכלל. הבדיקה נשאה שם של
   * הגנה שהיא לא בדקה — בדיוק שתי הבדיקות ששיקרו קודם ב-PR הזה.
   *
   * ‎`talktime = 0` הוא אמירה מפורשת שלא היה דיבור, והוא מאוחר
   * מה-`Answer`: מרכזייה יכולה לצלצל, לענות במענה קולי ולנתק.
   */
  it("„לא נענתה” גובר על אירוע מענה קודם — מענה קולי אינו שיחה", () => {
    expect(callSpoke(event({ type: "missed" }), true)).toBe(false);
  });

  it("אירוע מענה הוא ראיה כשאין משך", () => {
    expect(callSpoke(event({ type: "ended" }), true)).toBe(true);
    expect(callSpoke(event({ type: "ended" }), false)).toBe(false);
  });

  it("משך חיובי הוא ראיה גם בלי אירוע מענה", () => {
    expect(callSpoke(event({ type: "ended", durationSeconds: 12 }), false)).toBe(true);
  });
});

describe("callIsFinal", () => {
  /*
   * ‎`answered` אינו מסיים שיחה — הוא אמצע. הבדיקה קיימת כי בדיוק
   * הסוג הזה נשכח פעם אחת ברשימה שנכתבה ידנית במקום הקריאה.
   */
  it("רק ניתוק ו„לא נענתה” מסיימים — צלצול ומענה אינם", () => {
    expect(callIsFinal(event({ type: "ended" }))).toBe(true);
    expect(callIsFinal(event({ type: "missed" }))).toBe(true);
    expect(callIsFinal(event({ type: "answered" }))).toBe(false);
    expect(callIsFinal(event({ type: "ringing" }))).toBe(false);
  });

  it("מסכימה עם `callAction` — הן אינן שתי הגדרות", () => {
    for (const type of ["ringing", "answered", "ended", "missed"] as const) {
      expect(callAction(event({ type }), true, false).logCall).toBe(callIsFinal(event({ type })));
    }
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

describe("build015DialUrl", () => {
  const base = {
    authUsername: "office",
    authPassword: "s3cret",
    agentLine: "0501234567",
    destination: "0529876543",
  };

  it("שמות הפרמטרים בדיוק כמו בתיעוד של 015", () => {
    const url = new URL(build015DialUrl(base));
    expect(url.origin + url.pathname).toBe(PBX015_MAKE_URL);
    expect(url.searchParams.get("auth_username")).toBe("office");
    expect(url.searchParams.get("auth_password")).toBe("s3cret");
    expect(url.searchParams.get("stype")).toBe("phone");
    expect(url.searchParams.get("snumber")).toBe("0501234567");
    expect(url.searchParams.get("cnumber")).toBe("0529876543");
  });

  /*
   * ‎`ctype` ריק = מספר חיצוני. התיעוד מסמן אותו כ"מומלץ", והשמטתו
   * הותירה את הפירוש לברירת המחדל של הספק — שאם תיפול ל"קו", היעד
   * היה מתפרש כשלוחה פנימית והשיחה ללקוח לא הייתה יוצאת.
   */
  it("ctype נשלח ריק — היעד הוא מספר חיצוני ולא שלוחה", () => {
    const url = new URL(build015DialUrl(base));
    expect(url.searchParams.has("ctype")).toBe(true);
    expect(url.searchParams.get("ctype")).toBe("");
  });

  it("הסוכן ראשון והלקוח שני — ולא הפוך", () => {
    // היפוך היה מצלצל אצל הלקוח וממתין שהוא יענה כדי לחייג לסוכן
    const url = new URL(build015DialUrl(base));
    expect(url.searchParams.get("snumber")).toBe(base.agentLine);
    expect(url.searchParams.get("cnumber")).toBe(base.destination);
  });

  it("wait נשלח תמיד — בלעדיו אין callid לקשור אליו את הוובהוק", () => {
    expect(new URL(build015DialUrl(base)).searchParams.get("wait")).toBe("5");
  });

  it("מזהה המתקשר יושב על הרגל השנייה — זו שהלקוח רואה", () => {
    const url = new URL(build015DialUrl({ ...base, callerId: "037654321" }));
    expect(url.searchParams.get("callerid2")).toBe("037654321");
    expect(url.searchParams.get("callerid1")).toBeNull();
  });

  it("בלי מזהה מתקשר — הפרמטר לא נשלח כלל", () => {
    expect(new URL(build015DialUrl(base)).searchParams.get("callerid2")).toBeNull();
  });
});

describe("parse015DialResponse", () => {
  it("200 מחזיר את מזהה השיחה", () => {
    const res = parse015DialResponse({
      responses: [{ code: "200", message: "OK" }],
      data: { server: "server01", callid: "1234567890.123456" },
    });
    expect(res.ok).toBe(true);
    expect(res.callId).toBe("1234567890.123456");
  });

  it("204 הוא הצלחה ולא כשל — השיחה כבר מצלצלת", () => {
    // התייחסות ל-204 ככשל הייתה מציגה שגיאה על שיחה שיוצאת בפועל
    const res = parse015DialResponse({ responses: [{ code: "204", message: "OK" }] });
    expect(res.ok).toBe(true);
    expect(res.callId).toBeUndefined();
  });

  it("401 מתורגם למה שצריך לתקן", () => {
    const res = parse015DialResponse({ responses: [{ code: "401", message: "Unauthorized" }] });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("שם המשתמש או הסיסמה");
  });

  it("תשובה משובשת אינה נקראת כהצלחה", () => {
    expect(parse015DialResponse(null).ok).toBe(false);
    expect(parse015DialResponse({ responses: [] }).ok).toBe(false);
  });
});

describe("telephonyParseIssue", () => {
  const ok = { call_id: "1", caller: "0501234567", status: "hangup", duration: "30" };

  it("אירוע תקין — אין בעיה", () => {
    expect(telephonyParseIssue(ok)).toBeNull();
  });

  it("בלי מזהה שיחה", () => {
    expect(telephonyParseIssue({ caller: "0501234567" })).toBe("no_call_id");
  });

  it("בלי מספר — למשל שמות שדות שאיננו מכירים", () => {
    expect(telephonyParseIssue({ call_id: "1", weird_field: "0501234567" })).toBe("no_phone");
  });

  it("מספר חסוי הוא 'לא תקין' ולא 'שדות לא מוכרים'", () => {
    /*
     * זו כל הנקודה: מספר חסוי הוא מצב נורמלי, והצגתו כתקלת מיפוי
     * שולחת את מנהל המשרד לחפש בעיה שאינה קיימת.
     */
    expect(telephonyParseIssue({ ...ok, caller: "anonymous" })).toBe("invalid_phone");
    expect(telephonyParseIssue({ ...ok, caller: "" , from: "private" })).toBe("invalid_phone");
  });

  it("מסכים עם parseTelephonyEvent — null בדיוק כשיש בעיה", () => {
    expect(parseTelephonyEvent(ok) === null).toBe(telephonyParseIssue(ok) !== null);
    const bad = { ...ok, caller: "123" };
    expect(parseTelephonyEvent(bad) === null).toBe(telephonyParseIssue(bad) !== null);
  });
});

describe("safeDiagnosticKeys", () => {
  it("שמות שדות רגילים עוברים כמו שהם", () => {
    expect(safeDiagnosticKeys(["call_id", "caller", "status"])).toBe("call_id, caller, status");
  });

  it("מפתח שנראה כמו מספר טלפון אינו נשמר", () => {
    // ספק עם מפתחות דינמיים היה מכניס PII לעמודה גלויה וללוג
    const out = safeDiagnosticKeys(["call_id", "0501234567"]);
    expect(out).not.toContain("0501234567");
    expect(out).toContain("call_id");
  });

  it("כפילויות מתמזגות — לא עשרים פעם אותו סימון", () => {
    expect(safeDiagnosticKeys(["+97250111", "+97250222"])).toBe("‹שדה לא תקני›");
  });

  it("חסום באורך ובכמות", () => {
    const many = Array.from({ length: 200 }, (_, i) => `field_${i}`);
    const out = safeDiagnosticKeys(many);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.split(", ").length).toBeLessThanOrEqual(25);
  });
});

describe("mergeIntegrationSecrets", () => {
  const KEYS = ["authPassword", "apiSecret"];

  it("סוד שלא נשלח נשמר — זה הבאג שמחק סיסמה שמורה", () => {
    const out = mergeIntegrationSecrets({ authPassword: "סיסמה" }, {}, KEYS);
    expect(out["authPassword"]).toBe("סיסמה");
  });

  it("שמירה שמילאה רק שדה אחד אינה מוחקת את השני", () => {
    const out = mergeIntegrationSecrets(
      { authPassword: "סיסמה", apiSecret: "סוד" },
      { apiSecret: "סוד-חדש" },
      KEYS,
    );
    expect(out).toEqual({ authPassword: "סיסמה", apiSecret: "סוד-חדש" });
  });

  it("ערך חדש דורס את הישן", () => {
    const out = mergeIntegrationSecrets({ authPassword: "ישן" }, { authPassword: "חדש" }, KEYS);
    expect(out["authPassword"]).toBe("חדש");
  });

  it("החלפת ספק מנקה — סוד של ספק קודם לא נגרר", () => {
    const out = mergeIntegrationSecrets({ apiSecret: "של ספק קודם" }, { authPassword: "של-015" }, KEYS, {
      providerChanged: true,
    });
    expect(out).toEqual({ authPassword: "של-015" });
  });

  it("מפתח שאינו ברשימת הסודות של הספק נזרק", () => {
    // כך שם המשתמש, שעבר להיות שדה גלוי, מתנקה מהגוש המוצפן מעצמו
    const out = mergeIntegrationSecrets({ authUsername: "עברי" }, { authPassword: "ס" }, KEYS);
    expect(out["authUsername"]).toBeUndefined();
  });

  it("מחרוזת ריקה או רווחים אינה נשמרת כערך", () => {
    const out = mergeIntegrationSecrets({}, { authPassword: "   " }, KEYS);
    expect(out).toEqual({});
  });

  it("ערכים נשמרים מקוצצי רווחים — הדבקה מהדפדפן גוררת רווח בסוף", () => {
    const out = mergeIntegrationSecrets({}, { authPassword: " סיסמה " }, KEYS);
    expect(out["authPassword"]).toBe("סיסמה");
  });
});

describe("telephonySecretKeys", () => {
  it("ב-015 רק הסיסמה סודה — שם המשתמש הוא שם, לא מפתח", () => {
    const provider = telephonyProvider("015")!;
    expect(telephonySecretKeys(provider)).toEqual(["authPassword"]);
  });

  it("כל ספק עם יותר מסוד אחד חייב מיזוג לפי מפתח", () => {
    /*
     * הבדיקה הזו אינה על ההווה אלא על העתיד: ברגע שספק כלשהו יקבל
     * סוד שני, הריקוד של "השאירו ריק כדי לא לשנות" חוזר להיות מסוכן.
     * `mergeIntegrationSecrets` הוא הדרך היחידה לשמור סודות, וכאן
     * מוודאים שהיא מחזיקה בדיוק את מה שהספק מכריז עליו.
     */
    for (const provider of TELEPHONY_PROVIDERS) {
      const keys = telephonySecretKeys(provider);
      const kept = mergeIntegrationSecrets(
        Object.fromEntries(keys.map((k) => [k, `ערך-${k}`])),
        {},
        keys,
      );
      expect(Object.keys(kept).sort()).toEqual([...keys].sort());
    }
  });
});

describe("mergeLegacySecretsIntoConfig", () => {
  const p015 = telephonyProvider("015")!;

  it("שם משתמש ששמור בגוש המוצפן מוצג כשדה גלוי", () => {
    const out = mergeLegacySecretsIntoConfig(p015, {}, { authUsername: "office" });
    expect(out["authUsername"]).toBe("office");
  });

  it("ערך שכבר ב-config גובר על הישן", () => {
    const out = mergeLegacySecretsIntoConfig(
      p015,
      { authUsername: "חדש" },
      { authUsername: "ישן" },
    );
    expect(out["authUsername"]).toBe("חדש");
  });

  it("סוד אמיתי לעולם אינו נחשף דרך config", () => {
    const out = mergeLegacySecretsIntoConfig(p015, {}, { authPassword: "s3cret" });
    expect(out["authPassword"]).toBeUndefined();
  });

  it("שדה ריק ב-config נחשב חסר — כך נראה טופס שנשמר לפני ההגירה", () => {
    const out = mergeLegacySecretsIntoConfig(p015, { authUsername: "  " }, { authUsername: "office" });
    expect(out["authUsername"]).toBe("office");
  });

  it("החזרה מלאה: הגישור מציג, השמירה מהגרת, והעותק הישן נזרק", () => {
    /*
     * זה הרצף שבו הבאג נולד — טופס שהציג ריק, שמירה שכתבה ריק,
     * ומיזוג שזרק את הערך הישן כי הוא כבר לא מפתח סוד.
     */
    const legacy = { authUsername: "office", authPassword: "s3cret" };
    // 1. המסך קורא — ורואה את שם המשתמש
    const shown = mergeLegacySecretsIntoConfig(p015, {}, legacy);
    expect(shown["authUsername"]).toBe("office");
    // 2. המנהל שומר; הטופס מחזיר את מה שהוצג, והסיסמה נשארת ריקה
    const savedSecrets = mergeIntegrationSecrets(legacy, {}, telephonySecretKeys(p015));
    // 3. הסיסמה שרדה, שם המשתמש עבר ל-config ואינו נשאר מוצפן
    expect(savedSecrets).toEqual({ authPassword: "s3cret" });
    expect(shown["authUsername"]).toBe("office");
  });
});

describe("שמות השדות של 015", () => {
  /** מה ש-015 שולח כשמדביקים את תבנית ה-JSON שלו כמו שהיא. */
  function pbx015(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      callid: "1712345678.99",
      uniqueid: "leg-1",
      status: "Hangup",
      callerid_external: "0501234567",
      snumber: "101",
      cnumber: "037654321",
      direction: "inbound",
      totaltime: "35",
      talktime: "0",
      extension: "101",
      ...overrides,
    };
  }

  it("התבנית המקורית של 015 נקלטת בלי לגעת בה", () => {
    const parsed = parseTelephonyEvent(pbx015());
    expect(parsed).not.toBeNull();
    expect(parsed?.peerPhone).toBe("+972501234567");
    expect(parsed?.providerCallId).toBe("1712345678.99");
  });

  it("callid עדיף על uniqueid — uniqueid הוא רגל בודדת", () => {
    // שתי רגליים של אותה שיחה נושאות callid זהה; חיבור לפי uniqueid
    // היה רושם את הצלצול ואת הניתוק כשתי שיחות נפרדות
    expect(parseTelephonyEvent(pbx015())?.providerCallId).toBe("1712345678.99");
  });

  it("talktime אפס עם totaltime חיובי = שיחה שלא נענתה", () => {
    /*
     * זה בדיוק המקרה שהמשתמש דיווח עליו: התקשר ולא נענה. העדפת
     * totaltime הייתה מסווגת אותו כשיחה שהתקיימה — 35 שניות של צלצול
     * שנרשמות כשיחה בת 35 שניות.
     */
    expect(parseTelephonyEvent(pbx015())?.type).toBe("missed");
  });

  it("שיחה שנענתה באמת מקבלת את משך הדיבור", () => {
    const parsed = parseTelephonyEvent(pbx015({ totaltime: "95", talktime: "60" }));
    expect(parsed?.type).toBe("ended");
    expect(parsed?.durationSeconds).toBe(60);
  });

  it("Calling הוא צלצול ולא ניחוש של ברירת המחדל", () => {
    expect(parseTelephonyEvent(pbx015({ status: "Calling", talktime: "" }))?.type).toBe("ringing");
  });

  it("Hangup Answered Only הוא סיום ולא מענה", () => {
    /*
     * הוא מכיל "answered". בדיקת המענה לפני הסיום הייתה מסווגת את
     * אירוע הניתוק היחיד כ"נענתה" — ואז שורת השיחה לא נרשמת כלל,
     * כי רק אירוע סופי נרשם.
     */
    /*
     * ‎`totaltime` מוגדל יחד עם `talktime`: משך שיחה הגדול מהמשך
     * הכולל אינו מצב שיכול לקרות — הכולל מכיל את הצלצול — והצירוף
     * הישן (42 מול 35) בדק את קדימות שם הסטטוס על נתון בלתי אפשרי.
     */
    const parsed = parseTelephonyEvent(
      pbx015({ status: "Hangup Answered Only", talktime: "42", totaltime: "60" }),
    );
    expect(parsed?.type).toBe("ended");
    expect(callAction(parsed!, true, false).logCall).toBe(true);
  });

  /**
   * ‎**שלוש הדגימות מהמשרד, כפי שהגיעו.**
   *
   * הן כאן ולא בניסוח מופשט כי הן מה שהפריך את שתי ההשערות הקודמות
   * שלי: ש-`talktime` חסר בשיחה שלא נענתה (הוא 14), ושאפשר להסתמך
   * על `answered` (הוא מלא גם כשאיש לא ענה — זו חותמת ה-IVR).
   */
  describe("משרד עם הודעת פתיחה — ההפרש הוא הראיה", () => {
    const call = (talktime: string, totaltime: string) =>
      parseTelephonyEvent(pbx015({ status: "Hangup", talktime, totaltime, extension: "" }));

    it("ניתק בתוך ההודעה — לא נענתה", () => {
      const parsed = call("14", "14");
      expect(parsed?.type).toBe("missed");
      expect(callOutcomeOf(parsed!, true)).toBe("missed");
    });

    it("הנייד צלצל עד הסוף ואיש לא ענה — לא נענתה", () => {
      const parsed = call("20", "20");
      expect(parsed?.type).toBe("missed");
      expect(callOutcomeOf(parsed!, true)).toBe("missed");
    });

    /*
     * ‎`answerObserved` הוא `true` בשלושתן — ה-IVR ענה בכולן. אילו
     * הוא היה עדיין נחשב ראיה, שלושתן היו „נענתה”.
     */
    it("אדם ענה — ההפרש חיובי, וזו הראיה", () => {
      const parsed = call("115", "138");
      expect(parsed?.type).toBe("ended");
      expect(callOutcomeOf(parsed!, true)).toBe("answered");
    });
  });

  /*
   * ספק ששולח משך אחד בלבד ממשיך לעבוד כמו קודם — אין הפרש לבחון,
   * ומשך חיובי הוא הראיה הטובה ביותר שיש.
   */
  it("ספק בלי totaltime — משך חיובי נשאר הראיה", () => {
    const parsed = parseTelephonyEvent({
      callid: "x1",
      status: "Hangup",
      callerid_external: "0501234567",
      direction: "inbound",
      duration: "42",
    });
    expect(parsed?.type).toBe("ended");
    expect(callOutcomeOf(parsed!, false)).toBe("answered");
  });

  it("Abandon — מתקשר שוויתר בתור — נרשם כשיחה שלא נענתה", () => {
    expect(parseTelephonyEvent(pbx015({ status: "Abandon", talktime: "" }))?.type).toBe("missed");
  });

  it("noanswer אינו 'נענתה' — הבדיקה הזו הייתה קוד מת", () => {
    // "noanswer".includes("answer") הוא אמת
    expect(parseTelephonyEvent(pbx015({ status: "NoAnswer", talktime: "" }))?.type).toBe("missed");
  });

  it("שיחה יוצאת נתלית על cnumber — הלקוח, לא השלוחה", () => {
    const parsed = parseTelephonyEvent(
      pbx015({ direction: "outbound", snumber: "0501111111", cnumber: "0529876543" }),
    );
    expect(parsed?.peerPhone).toBe("+972529876543");
  });

  it("שלוחה פנימית ב-snumber אינה מפילה שיחה נכנסת", () => {
    // callerid_external נקרא לפניו; בלי זה "101" היה נכשל בוולידציה
    expect(parseTelephonyEvent(pbx015())?.peerPhone).toBe("+972501234567");
  });

  it("האבחון והניתוח מסכימים על כל שדות 015", () => {
    /*
     * הבדיקה האמיתית מאחורי readCore: שמות השדות היו בשני עותקים,
     * והוספת שם לצד אחד בלבד הייתה יוצרת אירוע שנקלט ומאובחן
     * כ"חסר מספר", או להפך.
     */
    expect(telephonyParseIssue(pbx015())).toBeNull();
    const noPhone = pbx015({ callerid_external: "", snumber: "", cnumber: "", dnumber: "" });
    expect(parseTelephonyEvent(noPhone)).toBeNull();
    expect(telephonyParseIssue(noPhone)).toBe("no_phone");
    const noId = pbx015({ callid: "", uniqueid: "" });
    expect(parseTelephonyEvent(noId)).toBeNull();
    expect(telephonyParseIssue(noId)).toBe("no_call_id");
  });
});

describe("sipUriFor", () => {
  it("מחייג בצורה המקומית ולא הבינלאומית", () => {
    /*
     * המספרים נשמרים אצלנו ב-E.164, אבל מרכזייה ישראלית מחזירה 404
     * על +972501234567 — מספר תקין לחלוטין שפשוט אינו בצורה שהיא
     * מכירה. השגיאה נראית כמו "המספר לא קיים" ואינה קשורה למספר.
     */
    expect(sipUriFor("+972501234567", "sip.015.net")).toBe("sip:0501234567@sip.015.net");
  });

  it("מספר מקומי נשאר כפי שהוא", () => {
    expect(sipUriFor("037654321", "pbx.example")).toBe("sip:037654321@pbx.example");
  });

  it("מנקה תווי עיצוב", () => {
    expect(sipUriFor("050-123-4567", "pbx.example")).toBe("sip:0501234567@pbx.example");
  });

  it("מספר זר אינו מומר בכוח לצורה ישראלית", () => {
    expect(sipUriFor("+14155550123", "pbx.example")).toBe("sip:+14155550123@pbx.example");
  });
});

describe("phoneFromSipUri", () => {
  it("מחלץ את המספר מכתובת נכנסת", () => {
    expect(phoneFromSipUri("sip:0501234567@pbx.example")).toBe("0501234567");
  });

  it("עובד גם על sips", () => {
    expect(phoneFromSipUri("sips:0501234567@pbx.example:5061")).toBe("0501234567");
  });

  it("מספר חסוי מחזיר ריק ולא זבל", () => {
    // "anonymous" הוא מה ש-SIP שולח על מספר חסוי — לא מספר
    expect(phoneFromSipUri("sip:anonymous@anonymous.invalid")).toBe("");
  });
});

describe("softphoneGap", () => {
  const ready = {
    connected: true,
    wssUrl: "wss://pbx.example/ws",
    domain: "pbx.example",
    username: "101",
    hasPassword: true,
  };

  it("הכול מוכן — אין חוסר", () => {
    expect(softphoneGap(ready)).toBeNull();
  });

  it("כל חוסר מזוהה בנפרד — שניים על המנהל ושניים על הסוכן", () => {
    expect(softphoneGap({ ...ready, connected: false })).toBe("no_integration");
    expect(softphoneGap({ ...ready, wssUrl: "" })).toBe("no_wss");
    expect(softphoneGap({ ...ready, domain: "  " })).toBe("no_domain");
    expect(softphoneGap({ ...ready, username: "" })).toBe("no_line");
    expect(softphoneGap({ ...ready, hasPassword: false })).toBe("no_line_password");
  });

  it("חוסר של המשרד קודם לחוסר של הסוכן", () => {
    /*
     * סוכן שאין לו קו, במשרד שאין לו WSS, יראה את הבעיה של המשרד.
     * ההפך היה שולח אותו למלא קו שלא יעבוד ממילא.
     */
    expect(softphoneGap({ connected: true, username: "", hasPassword: false })).toBe("no_wss");
  });
});

describe("softphoneOfficeReady", () => {
  it("מרכזייה פעילה עם WSS ודומיין — מוכן, בלי קשר לקו של הסוכן", () => {
    expect(
      softphoneOfficeReady({ connected: true, wssUrl: "wss://pbx.example/ws", domain: "pbx.example" }),
    ).toBe(true);
  });

  it("כל חוסר בצד המשרד מסתיר את הכפתור", () => {
    expect(softphoneOfficeReady({ connected: false, wssUrl: "wss://x/ws", domain: "x" })).toBe(false);
    expect(softphoneOfficeReady({ connected: true, wssUrl: "  ", domain: "x" })).toBe(false);
    expect(softphoneOfficeReady({ connected: true, wssUrl: "wss://x/ws" })).toBe(false);
  });
});

describe("telephonyParseIssue — בקשה ריקה", () => {
  it("גוף ריק הוא אבחנה נפרדת ולא 'חסר מזהה שיחה'", () => {
    /*
     * כך נראית אי-התאמה בין Content-Type לתבנית: השרת לא מפרסר,
     * הגוף מגיע כאובייקט ריק, וכל שדה חסר. הודעה על מזהה שיחה הייתה
     * שולחת לחפש הגדרה אצל הספק במקום שורה אחת בכותרות.
     */
    expect(telephonyParseIssue({})).toBe("no_fields");
  });

  it("שדות קיימים בלי מזהה — עדיין no_call_id", () => {
    expect(telephonyParseIssue({ caller: "0501234567" })).toBe("no_call_id");
  });
});

describe("sipUriFor — ניקוי לפני הכול", () => {
  it("תווי בקרה אינם מגיעים לכתובת גם בענף הישראלי", () => {
    /*
     * שורה חדשה בתוך URI היא הזרקת כותרת ב-SIP. הענף של +972 עשה
     * slice בלי לנקות, ולכן מספר שמור פגום היה עובר דרכו כמו שהוא.
     */
    expect(sipUriFor("+972\r\nTo: <sip:evil@x>\r\n501234567", "pbx")).toBe(
      "sip:0501234567@pbx",
    );
  });

  it("רווחים ונקודות אינם שורדים", () => {
    expect(sipUriFor("+972 50 123 4567", "pbx")).toBe("sip:0501234567@pbx");
  });
});

describe("diagnosticFields", () => {
  /*
   * הצורך שבגללו הפונקציה קיימת: כשמרכזייה מתחילה לשלוח שדה חדש,
   * "הוא הגיע" אינו מספיק — צריך לראות את הצורה של הערך כדי לבנות
   * מולו. נתיב הקלטה הוא המקרה שהוליד את זה.
   */
  it("שדה טכני נשמר עם הערך", () => {
    const out = diagnosticFields({ recording: "/rec/2026/08/19/abc.wav", status: "hangup" });
    expect(out).toContain("recording=/rec/2026/08/19/abc.wav");
    expect(out).toContain("status=hangup");
  });

  /*
   * רשימת היתר ולא רשימת חסימה: הגוף מגיע מגורם חיצוני, וכל שדה
   * שלא חשבנו עליו עלול להכיל מספר טלפון או שם.
   */
  it("שדה שמזהה אדם נשמר בשמו בלבד", () => {
    const out = diagnosticFields({
      callerid_external: "0501234567",
      callername: "דנה לוי",
      snumber: "0509999999",
    });
    expect(out).toContain("callerid_external");
    expect(out).not.toContain("0501234567");
    expect(out).not.toContain("דנה לוי");
    expect(out).not.toContain("0509999999");
  });

  it("שדה שאינו ברשימת ההיתר נשמר בשמו בלבד", () => {
    const out = diagnosticFields({ mystery: "סוד" });
    expect(out).toContain("mystery");
    expect(out).not.toContain("סוד");
  });

  it("שם שדה לא תקני מסומן ואינו נכתב", () => {
    expect(diagnosticFields({ "0501234567": "x" })).toContain("‹שדה לא תקני›");
    expect(diagnosticFields({ "0501234567": "x" })).not.toContain("0501234567");
  });

  it("ערך ארוך נחתך ואינו מציף את השורה", () => {
    const out = diagnosticFields({ recording: "a".repeat(500) });
    expect(out.length).toBeLessThan(200);
  });

  /*
   * ההבחנה שבלעדיה אי אפשר לאבחן: שדה טכני שהגיע ריק נראה בדיוק
   * כמו שדה מזהה שהערך שלו מוסתר בכוונה. 015 שולחת תבנית עם
   * placeholders, וכשאחד מהם אינו נתמך היא שולחת אותו ריק — ואז
   * „direction הגיע” אינו אומר אם הכיוון ידוע או לא.
   */
  it("שדה טכני שהגיע ריק מסומן כריק, ולא כשדה מוסתר", () => {
    const out = diagnosticFields({ direction: "", extension: "", status: "Hangup" });
    expect(out).toContain(`direction=${EMPTY_FIELD_MARK}`);
    expect(out).toContain(`extension=${EMPTY_FIELD_MARK}`);
    expect(out).toContain("status=Hangup");
  });

  /*
   * השדה שמכריע `no_phone` הוא שדה **מזהה**, ולכן ערכו לעולם אינו
   * מוצג. אילו ההסתרה קדמה לבדיקת הריקנות, דווקא הוא לא היה יכול
   * להיות מסומן כריק — והמסך מבטיח את הסימון הזה במפורש.
   *
   * „ריק” אינו ערך של לקוח: סימונו אומר שאין מה לחשוף.
   */
  it("שדה מזהה ריק מסומן כריק; עם ערך — השם בלבד", () => {
    expect(diagnosticFields({ callerid_external: "0501234567" })).toBe("callerid_external");
    expect(diagnosticFields({ callerid_external: "" })).toBe(
      `callerid_external=${EMPTY_FIELD_MARK}`,
    );
  });

  /*
   * `pickFrom` רואה במחרוזת של רווחים בלבד שדה חסר. אילו האבחון היה
   * מציג „direction=   ” — כלומר „יש ערך” — שתי קריאות של אותו
   * payload היו סותרות זו את זו בדיוק בשאלה שבגללה קוראים אותו.
   */
  it("שדה שמלא ברווחים בלבד נחשב ריק, כמו בניתוח", () => {
    const out = diagnosticFields({ direction: "   ", callerid_external: "  " });
    expect(out).toContain(`direction=${EMPTY_FIELD_MARK}`);
    expect(out).toContain(`callerid_external=${EMPTY_FIELD_MARK}`);
  });

  it("ערך שאינו טקסט או מספר נחשב ריק ולא מודלף", () => {
    const out = diagnosticFields({ status: { nested: "סוד" }, callername: { x: "דנה" } });
    expect(out).toContain(`status=${EMPTY_FIELD_MARK}`);
    expect(out).toContain(`callername=${EMPTY_FIELD_MARK}`);
    expect(out).not.toContain("סוד");
    expect(out).not.toContain("דנה");
  });
});

describe("unmappedFields", () => {
  /*
   * השאלה שהיומן לא ידע לענות עליה: לא "מה הגיע" אלא "מה מתוכו
   * נבלע". בלי זה, הוספת שם חדש לרשימה היא ניחוש מתוך שלושה-עשר
   * שדות.
   */
  it("מחזיר רק את מה שאיננו צורכים", () => {
    const out = unmappedFields({
      callid: "x",
      status: "hangup",
      callerid_external: "0501234567",
      A_PARTY: "0509999999",
      queue_name: "מכירות",
    });
    expect(out).toEqual(["A_PARTY", "queue_name"]);
  });

  it("payload שכולו מוכר מחזיר רשימה ריקה", () => {
    expect(unmappedFields({ callid: "x", status: "hangup", caller: "0501234567" })).toEqual([]);
  });

  /*
   * ההגנה מפני הכשל ההפוך: שדה שכבר נקלט תחת שם אחר אינו אמור
   * להופיע כ"מפוספס" ולשלוח לתקן משהו שעובד.
   */
  it("שם חלופי שכבר נתמך אינו מדווח כמפוספס", () => {
    expect(unmappedFields({ uniqueid: "x", billsec: "10", dst: "03111111" })).toEqual([]);
  });

  it("שדה ריק אינו מידע שהוחמץ", () => {
    expect(unmappedFields({ extra: "", blank: "   " })).toEqual([]);
  });

  it("שם שדה לא תקני מסומן ואינו נכתב", () => {
    const out = unmappedFields({ "0501234567": "x" });
    expect(out).toEqual(["‹שדה לא תקני›"]);
  });
});

describe("TELEPHONY_PROVIDERS", () => {
  /*
   * הקטלוג הוא הבטחה למשרד: כל שורה בו היא ספק שאפשר לבחור, וכל
   * שדה בשורה הוא פרט שהמשרד יתבקש למסור. ספק שאין לו קוד גובה
   * מהמשרד אישורי גישה למרכזייה שלו ולא נותן דבר בתמורה — וזה
   * בדיוק מה שקרה עם Zadarma ו-Voicenter.
   */
  it("כל ספק בקטלוג ממומש — אין שם בלי קוד", () => {
    expect(TELEPHONY_PROVIDERS.map((p) => p.id)).toEqual(["generic", "015"]);
  });

  it("ספק שאינו בקטלוג אינו נפתר", () => {
    expect(telephonyProvider("zadarma")).toBeUndefined();
    expect(telephonyProvider("voicenter")).toBeUndefined();
  });

  /*
   * חיוג יוצא ממומש מול 015 בלבד. הדגל היה `true` על ספקים שאין
   * להם שורת קוד שמחייגת, והמסך הבטיח כפתור שמחזיר שגיאה.
   */
  it("חיוג יוצא מסומן רק אצל מי שיש לו מימוש", () => {
    expect(TELEPHONY_PROVIDERS.filter((p) => p.clickToDial).map((p) => p.id)).toEqual(["015"]);
  });

  it("ספק שדורש שדות הוא ספק שקורא אותם", () => {
    // הגנרי אינו מבקש דבר — קליטת השיחות אינה תלוית ספק
    expect(telephonyProvider("generic")?.fields).toEqual([]);
  });
});

describe("nextRefusalStreak", () => {
  it("סירוב מגדיל", () => {
    expect(nextRefusalStreak(0, "refused")).toBe(1);
    expect(nextRefusalStreak(2, "refused")).toBe(3);
  });

  it("הצלחה מאפסת — הספק ענה, והוא בסדר", () => {
    expect(nextRefusalStreak(2, "stored")).toBe(0);
  });

  /*
   * ‎**זה הכלל שנשבר פעמיים.** הקוד איפס על כל מה שאינו סירוב,
   * וההערה שמעליו הבטיחה „כל הצלחה מאפסת” — שני ניסוחים שונים של
   * אותו כלל, והמחמיר שבהם לא היה זה שרץ.
   */
  it("כישלון מקומי אינו מאפס — הוא אינו מוכיח שהספק התאושש", () => {
    expect(nextRefusalStreak(2, "other")).toBe(2);
  });

  it("וגם אינו מגדיל — תקלה אצלנו אינה „לא” של הספק", () => {
    expect(nextRefusalStreak(0, "other")).toBe(0);
  });

  /*
   * הרצף שהממצא מתאר: שני סירובים, כישלון מקומי, ואז סירוב שלישי.
   * הכלל השבור היה מחזיר 1 כאן — כלומר העצירה לעולם לא הייתה
   * מתרחשת בזמן חנק שמלווה בכשלים מקומיים.
   */
  it("כישלון מקומי בין סירובים אינו מבטל את הרצף", () => {
    const seq = ["refused", "refused", "other", "refused"] as const;
    expect(seq.reduce<number>((n, r) => nextRefusalStreak(n, r), 0)).toBe(3);
  });
});
