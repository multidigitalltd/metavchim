import { describe, expect, it } from "vitest";
import {
  isSupportWaiting,
  matchesSupportFilter,
  openSupportCount,
  orderSupportQueue,
  searchSupportQueue,
  SUPPORT_QUEUE_FILTERS,
  supportQueueCounts,
  ticketTitle,
  waitingFirst,
  type SupportBucket,
  type SupportQueueFilter,
  type SupportQueueRow,
} from "./support-queue.js";

const row = (over: Partial<SupportQueueRow>): SupportQueueRow => ({
  source: "email",
  id: "01A",
  reference: 1,
  title: "נושא",
  who: "דנה",
  tenantName: null,
  status: "open",
  unread: false,
  lastActivityAt: "2026-08-01T10:00:00.000Z",
  kind: null,
  severity: null,
  contactEmail: null,
  contactPhone: null,
  ...over,
});

describe("סדר התור", () => {
  it("פתוחות לפני סגורות — גם כשהסגורה חדשה יותר", () => {
    /*
     * ‎**התקלה שהכלל הזה קיים בשבילה.** מיון לפי הערך של `status`
     * הוא לקסיקוגרפי, ושם `closed` < `in_progress` < `open` —
     * כלומר הסגורות עולות לראש. עם תקרה של 100 שורות זה אומר
     * שהתור הפתוח נעלם מהמסך.
     */
    const ordered = orderSupportQueue([
      row({ id: "סגורה-חדשה", status: "closed", lastActivityAt: "2026-08-05T00:00:00.000Z" }),
      row({ id: "פתוחה-ישנה", status: "open", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["פתוחה-ישנה", "סגורה-חדשה"]);
  });

  it("„בטיפול” נחשבת פתוחה — הפונה עדיין מחכה", () => {
    const ordered = orderSupportQueue([
      row({ id: "סגורה", status: "closed", lastActivityAt: "2026-08-09T00:00:00.000Z" }),
      row({ id: "בטיפול", status: "in_progress", lastActivityAt: "2026-08-02T00:00:00.000Z" }),
    ]);
    expect(ordered[0]?.id).toBe("בטיפול");
  });

  it("בתוך כל קבוצה — החדש בראש", () => {
    const ordered = orderSupportQueue([
      row({ id: "ישנה", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      row({ id: "חדשה", lastActivityAt: "2026-08-09T00:00:00.000Z" }),
      row({ id: "אמצע", lastActivityAt: "2026-08-05T00:00:00.000Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["חדשה", "אמצע", "ישנה"]);
  });

  it("שני המקורות משורגים לפי זמן, לא מקובצים לפי מקור", () => {
    // זה כל העניין: תור אחד, לא שתי רשימות זו אחר זו
    const ordered = orderSupportQueue([
      row({ id: "מייל-ישן", source: "email", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      row({ id: "כפתור-חדש", source: "app", lastActivityAt: "2026-08-09T00:00:00.000Z" }),
      row({ id: "מייל-חדש", source: "email", lastActivityAt: "2026-08-08T00:00:00.000Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["כפתור-חדש", "מייל-חדש", "מייל-ישן"]);
  });

  it("זמן זהה מוכרע במספר הפנייה — סדר יציב", () => {
    const same = "2026-08-05T00:00:00.000Z";
    const ordered = orderSupportQueue([
      row({ id: "א", reference: 5, lastActivityAt: same }),
      row({ id: "ב", reference: 9, lastActivityAt: same }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["ב", "א"]);
  });

  it("אינו משנה את המערך שהתקבל", () => {
    const rows = [row({ id: "א" }), row({ id: "ב", status: "closed" })];
    const before = rows.map((r) => r.id);
    orderSupportQueue(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("מונה הממתינות", () => {
  it("סופר פתוחות ובטיפול, לא סגורות", () => {
    expect(
      openSupportCount([
        row({ status: "open" }),
        row({ status: "in_progress" }),
        row({ status: "closed" }),
      ]),
    ).toBe(2);
  });
});

describe("כותרת פנייה מהכפתור", () => {
  it("השורה הראשונה בלבד", () => {
    expect(ticketTitle("לא מצליח להיכנס\nניסיתי שלוש פעמים")).toBe("לא מצליח להיכנס");
  });

  it("ארוכה נחתכת עם שלוש נקודות", () => {
    expect(ticketTitle("א".repeat(200))).toHaveLength(80);
    expect(ticketTitle("א".repeat(200)).endsWith("…")).toBe(true);
  });

  it("ריקה אינה שורה ריקה בתור", () => {
    expect(ticketTitle("   \n  ")).toBe("(פנייה ללא טקסט)");
  });
});

describe("הגבול חותך את הסגורות ולא את הממתינות", () => {
  /** מסד מדומה: שני דליים, כל אחד ממוין מהחדש לישן. */
  function desk(waiting: number, closed: number) {
    const calls: { bucket: string; take: number }[] = [];
    const rows = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    return {
      calls,
      fetch: async (bucket: SupportBucket, take: number): Promise<string[]> => {
        calls.push({ bucket, take });
        return rows(bucket === "waiting" ? "w" : "c", bucket === "waiting" ? waiting : closed).slice(
          0,
          take,
        );
      },
    };
  }

  it("פנייה ממתינה ישנה שורדת מאה סגורות חדשות", async () => {
    /*
     * זה כל הממצא: בשאילתה אחת עם `take`, מאה סגורות חדשות מוחקות
     * מהמסך את מי שבאמת מחכה — בלי שום סימן.
     */
    const { fetch } = desk(1, 500);
    const out = await waitingFirst(fetch, 100);
    expect(out[0]).toBe("w0");
    expect(out).toHaveLength(100);
  });

  it("כשהתור הממתין מלא — הסגורות לא נשלפות כלל", async () => {
    const { fetch, calls } = desk(500, 500);
    const out = await waitingFirst(fetch, 100);
    expect(out).toHaveLength(100);
    expect(out.every((row) => row.startsWith("w"))).toBe(true);
    expect(calls.map((call) => call.bucket)).toEqual(["waiting"]);
  });

  it("הסגורות ממלאות בדיוק את מה שנשאר", async () => {
    const { fetch, calls } = desk(30, 500);
    const out = await waitingFirst(fetch, 100);
    expect(calls).toEqual([
      { bucket: "waiting", take: 100 },
      { bucket: "closed", take: 70 },
    ]);
    expect(out).toHaveLength(100);
    expect(out.filter((row) => row.startsWith("w"))).toHaveLength(30);
  });

  it("תור ריק אינו שגיאה", async () => {
    const { fetch } = desk(0, 0);
    expect(await waitingFirst(fetch, 100)).toEqual([]);
  });
});

describe("„ממתינה” מוגדרת בשלילה", () => {
  /*
   * הכלל היה כתוב בשלושה נוסחים במקומות שונים, ושניים מהם הפסיקו
   * להסכים ברגע ש-`in_progress` נולד. מנייה חיובית של המצבים
   * הפתוחים הייתה משאירה כל סטטוס עתידי מחוץ למונה — בשקט.
   */
  it("כל מה שאינו סגור ממתין, כולל סטטוס שטרם קיים", () => {
    expect(isSupportWaiting("open")).toBe(true);
    expect(isSupportWaiting("in_progress")).toBe(true);
    expect(isSupportWaiting("escalated")).toBe(true);
    expect(isSupportWaiting("closed")).toBe(false);
  });

  it("‏„resolved” של פעם נחשב ממתין ולא נעלם", () => {
    /*
     * הסטטוס אוחד ל-`closed`, אבל שורה ישנה במסד עדיין יכולה
     * לשאת אותו. הכיוון הבטוח הוא להציג פנייה סגורה כפתוחה, לא
     * להעלים פנייה שמישהו מחכה לתשובה עליה.
     */
    expect(isSupportWaiting("resolved")).toBe(true);
  });

  it("המונה נגזר מאותו כלל", () => {
    const rows = [
      row({ id: "a", status: "open" }),
      row({ id: "b", status: "in_progress" }),
      row({ id: "c", status: "closed" }),
    ];
    expect(openSupportCount(rows)).toBe(2);
  });
});

describe("לשוניות הסינון", () => {
  /*
   * ‎**המספר על הלשונית ומה שהיא פותחת — אותו כלל.**
   *
   * זו הסיבה שהסינון ירד לכאן מהמסך. שני מימושים של „מה נכנס
   * ללשונית” נפרדים ברגע שנולד מצב חדש, ואז הלשונית מבטיחה שבע
   * ופותחת חמש — בלי ששום דבר נראה שבור.
   */
  it("הספירה מסכימה עם מה שהלשונית באמת מציגה", () => {
    const rows = [
      row({ id: "א", status: "open" }),
      row({ id: "ב", status: "in_progress" }),
      row({ id: "ג", status: "closed" }),
      row({ id: "ד", status: "closed" }),
    ];
    const counts = supportQueueCounts(rows);
    for (const filter of SUPPORT_QUEUE_FILTERS) {
      expect(rows.filter((r) => matchesSupportFilter(r, filter)).length, filter).toBe(
        counts[filter],
      );
    }
  });

  it("„ממתינות” מסכימה עם המונה שליד הכותרת", () => {
    const rows = [
      row({ status: "open" }),
      row({ status: "in_progress" }),
      row({ status: "closed" }),
    ];
    expect(supportQueueCounts(rows).waiting).toBe(openSupportCount(rows));
  });

  /*
   * מפתח שנוסף לטיפוס ואינו נספר היה מציג „0” על לשונית מלאה. הבדיקה
   * נבנית מרשימת הלשוניות עצמה, ולכן לשונית עתידית נגררת אליה.
   */
  it("לכל לשונית מוגדרת יש מונה", () => {
    const counts = supportQueueCounts([row({})]);
    for (const filter of SUPPORT_QUEUE_FILTERS) {
      expect(typeof counts[filter], filter).toBe("number");
    }
    // גם „נפתחה”, שאינה על הסרגל אך קיימת כמצב
    expect(counts satisfies Record<SupportQueueFilter, number>).toBeDefined();
  });
});

describe("חיפוש בתור", () => {
  const rows = [
    row({
      id: "דוד",
      reference: 1042,
      who: "דוד כהן",
      title: "לא מצליח להעלות תמונות",
      contactEmail: "david@example.co.il",
      contactPhone: "052-123-4567",
      severity: "blocking",
      kind: "bug",
    }),
    row({
      id: "רונית",
      reference: 1043,
      who: "רונית לוי",
      title: "בקשה להוסיף שדה",
      contactEmail: "ronit@example.co.il",
      tenantName: "משרד הצפון",
    }),
  ];

  it("שאילתה ריקה מחזירה הכול", () => {
    expect(searchSupportQueue(rows, "   ")).toHaveLength(2);
  });

  it("מוצא לפי מספר פנייה, עם סולמית ובלעדיה", () => {
    expect(searchSupportQueue(rows, "1042").map((r) => r.id)).toEqual(["דוד"]);
    expect(searchSupportQueue(rows, "#1042").map((r) => r.id)).toEqual(["דוד"]);
  });

  /*
   * ‎**המקפים הם של מי שהקליד, לא של מי שחיפש.** מספר נשמר בכל מיני
   * ניסוחים, וחיפוש שנשען על ההתאמה המדויקת שלהם אינו מוצא כלום
   * בדיוק כשצריך להתקשר.
   */
  it("מוצא טלפון גם כשהמקפים אינם במקום", () => {
    expect(searchSupportQueue(rows, "0521234567").map((r) => r.id)).toEqual(["דוד"]);
    expect(searchSupportQueue(rows, "052-1234").map((r) => r.id)).toEqual(["דוד"]);
  });

  it("מוצא לפי כתובת, שם משרד, וטקסט הפנייה", () => {
    expect(searchSupportQueue(rows, "ronit@").map((r) => r.id)).toEqual(["רונית"]);
    expect(searchSupportQueue(rows, "הצפון").map((r) => r.id)).toEqual(["רונית"]);
    expect(searchSupportQueue(rows, "תמונות").map((r) => r.id)).toEqual(["דוד"]);
  });

  /*
   * ‎**„וגם”, לא „או”.** חיפוש שמאחד את התוצאות של כל מילה מציף
   * במקום לצמצם — כלומר הופך שאילתה מדויקת יותר לרשימה ארוכה יותר,
   * ההפך הגמור ממה שמי שמקליד מנסה לעשות.
   */
  it("כל מילה חייבת להימצא", () => {
    expect(searchSupportQueue(rows, "דוד חוסם").map((r) => r.id)).toEqual(["דוד"]);
    expect(searchSupportQueue(rows, "דוד רונית")).toHaveLength(0);
  });

  it("מוצא לפי החומרה והסוג כפי שהם כתובים על השורה", () => {
    expect(searchSupportQueue(rows, "חוסם").map((r) => r.id)).toEqual(["דוד"]);
  });

  /*
   * ‎**ההשוואה על הספרות בלבד שמורה למילה שכולה מספר (ביקורת Codex).**
   *
   * היא הופעלה על כל מילה שיש בה ולו ספרה אחת, ולכן
   * ‎`user2@example.com` הצטמצם ל-„2” — שנמצא כמעט בכל שורה, כי מספר
   * הפנייה תמיד בערימת החיפוש. חיפוש אחרי כתובת **שאינה קיימת** החזיר
   * תוצאות, בניגוד גמור להבטחה ש„כל מילה חייבת להימצא”.
   */
  it("כתובת שאינה קיימת אינה מוצאת דבר — גם כשיש בה ספרה", () => {
    expect(searchSupportQueue(rows, "user2@example.com")).toHaveLength(0);
    expect(searchSupportQueue(rows, "david2@example.co.il")).toHaveLength(0);
  });

  it("שם עם ספרה אינו נופל להשוואת הספרות", () => {
    expect(searchSupportQueue(rows, "משרד2")).toHaveLength(0);
  });

  /*
   * ומה שבאמת מספר — עדיין עובד, בכל צורת כתיבה של אותן ספרות.
   *
   * ‎`+972…` אינו כאן בכוונה: המספר נשמר בצורה המקומית, והמרה בין
   * הצורות אינה מה שהחיפוש הזה עושה. הבדיקה נכתבה תחילה איתו,
   * נפלה, והתשובה הייתה שהציפייה שגויה — לא הקוד.
   */
  it("מספר עם מפרידים עדיין נמצא", () => {
    for (const term of ["052 123 4567", "(052) 123-4567", "0521234567", "#1042", "1042"]) {
      expect(searchSupportQueue(rows, term).map((r) => r.id), term).toEqual(["דוד"]);
    }
  });
});
