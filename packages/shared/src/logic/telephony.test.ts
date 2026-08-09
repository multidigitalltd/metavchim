import { describe, expect, it } from "vitest";
import {
  TELEPHONY_PROVIDERS,
  callAction,
  describeCall,
  incomingCallTitle,
  parseTelephonyEvent,
  telephonyProvider,
  type TelephonyEvent,
  build015DialUrl,
  parse015DialResponse,
  PBX015_MAKE_URL,
  safeDiagnosticKeys,
  telephonyParseIssue,
  mergeIntegrationSecrets,
  telephonySecretKeys,
  mergeLegacySecretsIntoConfig,
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
    const out = mergeIntegrationSecrets({ apiSecret: "של-Zadarma" }, { authPassword: "של-015" }, KEYS, {
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
