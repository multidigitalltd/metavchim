import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ContactsService } from "./contacts.service";

/**
 * ‎**„הוספת אדם קשור” הייתה קריאה לכרטיס מוסתר** (ביקורת Codex, P1).
 *
 * ‏הנתיב `POST /contacts/:id/people` נשמר בשער על כרטיס ה**אב**
 * ‏בלבד, ואילו `findOrCreateByPhone` מחפש משרד-רחב. כלומר סוכן
 * ‏שהקליד את הטלפון של הלקוח של עמית מיחזר את הכרטיס המוסתר שלו:
 * ‏`setEmail` דרס לו את הכתובת, והקישור שנוצר פתח את `peopleFor` —
 * ‏שמפענח שם, טלפון ואימייל. הזנת מספר, ושלושה שדות מוצפנים חזרו.
 *
 * ‏שני מקורות היתר, ולא אחד: לקוח שנגיש לי בזכות עצמו, **או** אדם
 * ‏שכבר מקושר לכרטיס הזה — אחרת עדכון תפקיד של מקושר קיים היה
 * ‏נדחה, כי אדם מקושר אינו קונה, ליד או בעל נכס.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";
const PARENT = "01PARENTAAAAAAAAAAAAAAAAAA";
const HIDDEN = "01HIDDENAAAAAAAAAAAAAAAAAA";

const AGENT: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const MANAGER: Capability[] = [...AGENT, "buyers.view_all", "properties.view_all"];

interface Options {
  /** ‏המספר שהוקלד כבר שייך לכרטיס קיים. */
  existing?: boolean;
  /** ‏ומי מחזיק בו — דרך כרטיס קונה. */
  buyerOwnerUserId?: string;
  /** ‏והאם הוא כבר מקושר לכרטיס האב. */
  alreadyLinked?: boolean;
  /**
   * ‎**כרטיס יתום** — קיים, אבל בלי קונה, ליד או נכס. זה מה
   * ‏ששיחה שלא נענתה מייצרת, והוא היה נדחה מכל סוכן.
   */
  orphan?: boolean;
  /**
   * ‎**מקושר ככרטיס משני על הלקוח של עמית** — בן זוג, שותף.
   * ‏אין עליו קונה/ליד/נכס משלו, ובכל זאת הוא תפוס: `peopleFor`
   * ‏חושף דרך הכרטיס המחזיק את שמו, הטלפון והדוא״ל שלו.
   */
  linkedElsewhere?: boolean;
  /** ‏השם השמור על הכרטיס הקיים — ברירת המחדל היא שם אמיתי. */
  storedName?: string;
}

interface Calls {
  emailWrites: number;
  links: number;
  nameWrites: number;
}

function serviceFor(options: Options): { service: ContactsService; calls: Calls } {
  const calls: Calls = { emailWrites: 0, links: 0, nameWrites: 0 };
  const owner = options.buyerOwnerUserId ?? OTHER;
  const tx = {
    $executeRaw: async () => 0,
    contact: {
      findUnique: async () => (options.existing === true ? { id: HIDDEN } : null),
      findFirst: async () => ({
        id: HIDDEN,
        nameEncrypted: options.storedName ?? "n",
        phoneEncrypted: "+972501234567",
      }),
      update: async () => {
        calls.nameWrites += 1;
        return { id: HIDDEN };
      },
      updateMany: async () => {
        calls.emailWrites += 1;
        return { count: 1 };
      },
      create: async () => ({ id: "01NEWAAAAAAAAAAAAAAAAAAAAA" }),
    },
    contactPhone: { findUnique: async () => null },
    contactLink: {
      /*
       * ‎`isOrphanContact` שואל גם על `related_contact_id`: אדם
       * ‏שמקושר ככרטיס משני על לקוח של עמית אינו פנוי.
       */
      findFirst: async (args: { where: { contactId?: string } }) =>
        /*
         * ‏שתי שאילתות שונות על אותה טבלה, ומבדיל ביניהן מי מסנן
         * ‏גם לפי כרטיס האב: `isOrphanContact` שואל „מקושר לאיזשהו
         * ‏כרטיס” (`relatedContactId` בלבד), ו-`linkPerson` שואל
         * ‏„מקושר **לכרטיס הזה**”. זרע שמחזיר את אותו דבר לשתיהן
         * ‏מאשר את אחת מהן על סמך השנייה.
         */
        args.where.contactId === undefined
          ? options.linkedElsewhere === true
            ? { id: "01LINK" }
            : null
          : options.alreadyLinked === true
            ? { id: "01LINK" }
            : null,
      upsert: async () => {
        calls.links += 1;
        return { id: "01LINK" };
      },
    },
    /* ‏מקורות `canSeeContact` — הכרטיס המוסתר הוא קונה של מישהו */
    buyer: {
      findFirst: async (args: { where: { ownerUserId?: string } }) =>
        options.orphan === true
          ? null
          : args.where.ownerUserId === undefined || args.where.ownerUserId === owner
            ? { id: "01BUYER" }
            : null,
    },
    lead: { findFirst: async () => null },
    property: { findFirst: async () => null },
  };
  const crypto = {
    phoneHash: () => "hash",
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
    emailHash: () => "ehash",
    nameHash: () => "nhash",
  };
  return { service: new ContactsService(crypto as never), calls, tx } as never;
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

function txOf(built: unknown): never {
  return (built as { tx: unknown }).tx as never;
}

const PERSON = { name: "בת זוג", phone: "+972501234567", role: "spouse" as const };

describe("הוספת אדם קשור — מספר שכבר שייך למישהו", () => {
  it("מספר של לקוח מוסתר — נדחה", async () => {
    const built = serviceFor({ existing: true });
    await expect(
      asUser(AGENT, () =>
        built.service.linkPerson(txOf(built), PARENT, {
          ...PERSON,
          email: "new@example.com",
        }),
      ),
    ).rejects.toThrow(/אינו נגיש/u);
  });

  /*
   * ‎**והדחייה קודמת לכתיבה.** בלי זה השער היה נכון לקריאה בלבד:
   * ‏האימייל של הלקוח המוסתר כבר נדרס, והקישור כבר נוצר.
   */
  it("ולא נכתב דבר לפני הדחייה", async () => {
    const built = serviceFor({ existing: true });
    await asUser(AGENT, () =>
      built.service
        .linkPerson(txOf(built), PARENT, { ...PERSON, email: "new@example.com" })
        .catch(() => undefined),
    );
    expect(built.calls.emailWrites, "האימייל של המוסתר נדרס").toBe(0);
    expect(built.calls.links, "נוצר קישור").toBe(0);
  });

  it("מספר חדש לגמרי — נוצר כרגיל", async () => {
    const built = serviceFor({ existing: false });
    const result = await asUser(AGENT, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
    expect(built.calls.links).toBe(1);
  });

  it("מספר של הלקוח שלי — מקושר כרגיל", async () => {
    const built = serviceFor({ existing: true, buyerOwnerUserId: ME });
    const result = await asUser(AGENT, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
  });

  /*
   * ‏המקור השני: אדם שכבר מקושר לכרטיס הזה. „הוספתי אותה כשותפה
   * ‏ואני רוצה בת זוג” היא פעולה סבירה, ולא ניסיון לגעת בזר.
   */
  it("מקושר קיים — עדכון תפקיד עובר", async () => {
    const built = serviceFor({ existing: true, alreadyLinked: true });
    const result = await asUser(AGENT, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
  });

  it("ומנהל משרד אינו מושפע", async () => {
    const built = serviceFor({ existing: true });
    const result = await asUser(MANAGER, () =>
      built.service.linkPerson(txOf(built), PARENT, PERSON),
    );
    expect(result.ok).toBe(true);
  });
});

/**
 * ‎**והכלל עצמו, ישירות — כי יש לו שלושה קוראים** (ביקורת Codex,
 * ‏P1, סבב שני).
 *
 * ‏אותו חור בדיוק היה גם בבעל הנכס ובדייר: `findOrCreateByPhone`
 * ‏מחפש משרד-רחב, והצירוף לרשומה שלי הוא שגורם ל-`canSeeContact`
 * ‏להצליח בקריאות הבאות. תיקנתי אותו ב„אדם קשור” בלבד, ולכן הוא
 * ‏יושב עכשיו במקום אחד ונבדק שם.
 */
describe("‏מיחזור כרטיס קיים — הכלל המשותף", () => {
  const PERSON_INPUT = { name: "בעל הנכס", phone: "+972501234567" };

  it("כרטיס מוסתר — נדחה, והנושא בהודעה", async () => {
    const built = serviceFor({ existing: true });
    await expect(
      asUser(AGENT, () =>
        built.service.findOrCreateByPhoneScoped(txOf(built), PERSON_INPUT, {
          subject: "בעל הנכס",
        }),
      ),
    ).rejects.toThrow(/בעל הנכס — המספר הזה משויך ללקוח שאינו נגיש לך/u);
  });

  it("מספר חדש — נוצר בלי לשאול", async () => {
    const built = serviceFor({ existing: false });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneScoped(txOf(built), PERSON_INPUT, { subject: "בעל הנכס" }),
    );
    expect(person.id).toBeDefined();
  });

  it("כרטיס שנגיש לי — מוחזר", async () => {
    const built = serviceFor({ existing: true, buyerOwnerUserId: ME });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneScoped(txOf(built), PERSON_INPUT, { subject: "בעל הנכס" }),
    );
    expect(person.id).toBe(HIDDEN);
  });

  /*
   * ‏מקור ההיתר השני, שהנכס משתמש בו: „הוא כבר על הרשומה הזו”.
   * ‏בלעדיו עריכה שאינה נוגעת בבעלים הייתה נדחית על הבעלים עצמו.
   */
  it("מקור היתר שני — מי שכבר מצורף כאן", async () => {
    const built = serviceFor({ existing: true });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneScoped(txOf(built), PERSON_INPUT, {
        subject: "בעל הנכס",
        alsoAllowed: (priorId) => priorId === HIDDEN,
      }),
    );
    expect(person.id).toBe(HIDDEN);
  });
});

/**
 * ‎**וההכרעה מי הקליד — הענף עצמו, במקום אחד.**
 *
 * ‏שלושת המסלולים (נכס, קונה, ליד) אינם בוחרים בעצמם בין הצורה
 * ‏השמורה לישירה: הם מוסרים את `typedBy` הלאה, וכאן נחתך הענף.
 * ‏שלישייה בכל שירות הייתה שלושה עותקים של „מי מותר לו למחזר”,
 * ‏שאפשר לתקן אחד מהם ולשכוח את השניים.
 */
describe("‏מי הקליד את המספר — הענף", () => {
  const PERSON = { name: "בעל הנכס", phone: "+972501234567" };

  it("‏`agent` על כרטיס מוסתר — נדחה", async () => {
    const built = serviceFor({ existing: true });
    await expect(
      asUser(AGENT, () =>
        built.service.findOrCreateByPhoneTyped(txOf(built), PERSON, {
          typedBy: "agent",
          subject: "יצירת קונה",
        }),
      ),
    ).rejects.toThrow(/יצירת קונה — המספר הזה משויך ללקוח שאינו נגיש לך/u);
  });

  /*
   * ‏והצד השני: הטופס הציבורי מקבל את המספר מבעליו, אין שם סוכן
   * ‏שאפשר לבדוק מולו, ומיחזור הכרטיס הקיים הוא בדיוק הנכון —
   * ‏כרטיס שני לאותו אדם הוא הבאג. בלי הצד הזה „תמיד לחסום” היה
   * ‏עובר, והקישור הפתוח היה שובר.
   */
  it("‏`office` על אותו כרטיס בדיוק — מוחזר", async () => {
    const built = serviceFor({ existing: true });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneTyped(txOf(built), PERSON, {
        typedBy: "office",
        subject: "טופס קליטה",
      }),
    );
    expect(person.id).toBe(HIDDEN);
  });

  it("‏`agent` על מספר חדש — נוצר כרגיל", async () => {
    const built = serviceFor({ existing: false });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneTyped(txOf(built), PERSON, {
        typedBy: "agent",
        subject: "יצירת קונה",
      }),
    );
    expect(person.id).toBeDefined();
  });

  /* ‏ו-`alsoAllowed` ממשיך לעבור דרך הענף — הנכס נשען עליו. */
  it("‏`agent` עם היתר נוסף — עובר", async () => {
    const built = serviceFor({ existing: true });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneTyped(txOf(built), PERSON, {
        typedBy: "agent",
        subject: "בעל הנכס",
        alsoAllowed: (priorId) => priorId === HIDDEN,
      }),
    );
    expect(person.id).toBe(HIDDEN);
  });
});

/**
 * ‎**ומי שיוצר כרטיס מטלפון באמת עובר דרך הכלל.**
 *
 * ‏הכלל נכון בפני עצמו, והשאלה הנפרדת היא החיווט: מסלול שחוזר
 * ‏ל-`findOrCreateByPhone` הישיר פותח מחדש בדיוק את החור. פיקסצ׳רים
 * ‏מלאים לשלושת המסלולים היו מחקים מכסות, גיאוקוד, התאמות ואודיט —
 * ‏כלומר בודקים בעיקר את עצמם — ולכן החיווט נבדק על המקור.
 *
 * ‏הסבב הקודם בדק את הנכס בלבד, ו**הקונה והליד נשארו בחוץ**: שניהם
 * ‏קראו ל-`findOrCreateByPhone` הישיר, ושניהם מצרפים את התוצאה
 * ‏לרשומה של הסוכן — כלומר אותו מפתח בדיוק לכרטיס מוסתר (ביקורת
 * ‏Codex, P1). הבדיקה כאן מנוסחת עכשיו על שלושתם.
 */
describe("‏שער: כל יצירת כרטיס מטלפון מצהירה מי הקליד", () => {
  const API_SRC = join(__dirname, "..", "..");

  function sources(): { file: string; text: string }[] {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
          out.push({ file: full.slice(API_SRC.length + 1), text: readFileSync(full, "utf8") });
        }
      }
    };
    walk(API_SRC);
    return out;
  }

  /** ‏חותך את אובייקט הארגומנטים שאחרי `from`. */
  function objectAfter(text: string, from: number): string {
    const start = text.indexOf("{", from);
    if (start === -1) return "";
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return "";
  }

  const FILES = sources();

  /**
   * ‏שערי הכניסה שהחתימה שלהם דורשת `typedBy`. הקומפיילר כבר אוכף
   * ‏שהשדה **קיים**; מה שנבדק כאן הוא שהוא הוכרע באתר הקריאה ולא
   * ‏זלג פנימה ממשתנה שהלקוח שולט בו.
   */
  const ENTRY = /this\.(?:leads|buyers)\.(?:create|createWithin|createForImport)\(/gu;

  const callSites = FILES.flatMap(({ file, text }) =>
    [...text.matchAll(ENTRY)].map((m) => ({
      file,
      line: text.slice(0, m.index).split("\n").length,
      args: objectAfter(text, m.index),
    })),
  );

  it("‏יש מה לבדוק — שערי הכניסה של קונה וליד", () => {
    expect(callSites.length).toBeGreaterThanOrEqual(5);
    expect(
      callSites.every((site) => site.args.length > 0),
      "לא נחתך אובייקט ארגומנטים",
    ).toBe(true);
  });

  it("‏כל אתר קריאה מכריע במפורש", () => {
    for (const site of callSites) {
      expect(
        /typedBy: "(?:agent|office)"/u.test(site.args),
        `${site.file}:${site.line} — יצירה בלי הכרעה מי הקליד`,
      ).toBe(true);
    }
  });

  /*
   * ‏פיקוח: בלעדיו הבדיקה הייתה ירוקה גם אילו כל אתר הצהיר
   * ‏`office`, כלומר אילו השער היה מנוטרל בכל מקום.
   */
  it("‏ושתי ההכרעות באמת מופיעות", () => {
    const all = callSites.map((site) => site.args).join("\n");
    expect(all.includes('typedBy: "agent"'), "אף אתר אינו של סוכן").toBe(true);
    expect(all.includes('typedBy: "office"'), "אף אתר אינו משרדי").toBe(true);
  });

  /*
   * ‎**וההכרעה עצמה יושבת במקום אחד.**
   *
   * ‏שלושת השירותים שיוצרים כרטיס מטלפון אינם בוחרים בעצמם בין
   * ‏הצורה השמורה לישירה — הם מוסרים את `typedBy` הלאה. שלישייה
   * ‏בכל אחד מהם הייתה שלושה עותקים של „מי מותר לו למחזר”.
   */
  it("‏והבחירה בין השמור לישיר יושבת רק ב-`ContactsService`", () => {
    for (const name of [
      "modules/properties/properties.service.ts",
      "modules/buyers/buyers.service.ts",
      "modules/leads/leads.service.ts",
    ]) {
      const source = FILES.find((f) => f.file === name);
      expect(source, name).toBeDefined();
      const direct = source!.text.match(/this\.contacts\.findOrCreateByPhone\(/gu) ?? [];
      expect(direct.length, `${name}: פתירה ישירה מחוץ ל-ContactsService`).toBe(0);
    }
    const contacts = FILES.find((f) => f.file === "modules/contacts/contacts.service.ts");
    const branch = contacts!.text.match(/options\.typedBy === "office"/gu) ?? [];
    expect(branch.length, "ההכרעה אינה יושבת בדיוק פעם אחת").toBe(1);
  });

  /* ‏ולכל קורא של `persist` בצד הנכס יש הכרעה מפורשת — כמו קודם. */
  it("‏ולכל קורא של `persist` בצד הנכס יש הכרעה מפורשת", () => {
    const source = FILES.find((f) => f.file === "modules/properties/properties.service.ts")!.text;
    const calls = source.match(/this\.persist\(/gu) ?? [];
    const decided = source.match(/typedBy: "(?:agent|office)"(?! \|)/gu) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(decided.length, "קורא בלי הכרעה").toBe(calls.length);
  });
});

/**
 * ‎**כרטיס יתום — ולמה הסירוב עליו היה שגוי** (דיווח מהשטח).
 *
 * ‏שיחה נכנסת שלא נענתה יוצרת כרטיס איש קשר, ותו לא: אין עליו
 * ‏קונה, אין ליד, ואין נכס. `canSeeContact` נשענת על קיומו של
 * ‏כרטיס עסקי כזה, ולכן החזירה `false` **לכל הסוכנים במשרד,
 * ‏כולל הבעלים** — והבקשה „תפתח קונה עם המספר הזה” נדחתה
 * ‏בהודעה „המספר משויך ללקוח שאינו נגיש לך”.
 *
 * ‏זו אותה תקלה שכבר תוקנה בכלל ראיית השיחות: „לא כי מישהו אחר
 * ‏ראה אותה — אלא כי אף אחד לא”. כרטיס יתום הוא פנוי, לא תפוס.
 */
describe("‏כרטיס שאיש אינו מחזיק בו", () => {
  const PERSON_INPUT = { name: "דנה כהן", phone: "+972501234567" };

  it("‏מספר שקיים רק כשיחה — הקונה נפתח", async () => {
    const built = serviceFor({ existing: true, orphan: true });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneTyped(txOf(built), PERSON_INPUT, {
        typedBy: "agent",
        subject: "יצירת קונה",
      }),
    );
    expect(person.id).toBe(HIDDEN);
  });

  /*
   * ‎**וזה מה שאסור שיזוז.** כרטיס שיש עליו קונה של עמית נשאר
   * ‏חסום — ההבדל בין „פנוי” ל„לא שלי” הוא כל התיקון.
   */
  it("‏ומספר של קונה של עמית — עדיין נדחה", async () => {
    const built = serviceFor({ existing: true });
    await expect(
      asUser(AGENT, () =>
        built.service.findOrCreateByPhoneTyped(txOf(built), PERSON_INPUT, {
          typedBy: "agent",
          subject: "יצירת קונה",
        }),
      ),
    ).rejects.toThrow(/משויך ללקוח שאינו נגיש לך/u);
  });
});

/**
 * ‎**„בשיחות לעדכן אותו בשם של הקונה שנכנס”** (דיווח מהשטח).
 *
 * ‏השיחה כותבת `callerName ?? phone`, ולכן כרטיס שנוצר משיחה
 * ‏שלא נענתה נקרא במספר של עצמו. עד כה `findOrCreateByPhone`
 * ‏החזיר את הכרטיס הקיים והתעלם מהשם הנכנס — ולכן גם אחרי
 * ‏שנפתח קונה בשם „דנה כהן”, רשימת השיחות המשיכה להציג מספר.
 */
describe("‏שם שהוא המספר עצמו — מתעדכן", () => {
  const PHONE = "+972501234567";

  it("‏מציין מקום מוחלף בשם שנמסר", async () => {
    const built = serviceFor({ existing: true, orphan: true, storedName: PHONE });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhone(txOf(built), { name: "דנה כהן", phone: PHONE }),
    );
    expect(person.name).toBe("דנה כהן");
    expect(built.calls.nameWrites, "השם לא נכתב").toBe(1);
  });

  /*
   * ‎**ושם אמיתי אינו נדרס.** ידע שהמשרד כבר הקליד שווה יותר
   * ‏מהשם שהגיע עכשיו, ודריסה שקטה שלו גרועה מהתקלה המקורית.
   */
  it("‏ושם אמיתי נשאר כפי שהוא", async () => {
    const built = serviceFor({ existing: true, orphan: true, storedName: "יוסי לוי" });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhone(txOf(built), { name: "דנה כהן", phone: PHONE }),
    );
    expect(person.name).toBe("יוסי לוי");
    expect(built.calls.nameWrites, "שם אמיתי נדרס").toBe(0);
  });
});

/**
 * ‎**קישור הוא החזקה** (ביקורת Codex, P1).
 *
 * ‏הגרסה הראשונה של הפתיחה בדקה קונים, לידים ונכסים בלבד. אדם
 * ‏שקיים רק כ-`contact_links.related_contact_id` על הלקוח של עמית
 * ‏נקרא „פנוי” — וסוכן אחר היה פותח עליו קונה ומקבל דרך
 * ‎`peopleFor` שם, טלפון ודוא״ל שאינם שלו.
 *
 * ‏התיקון אינו ענף חמישי אלא **מחיקת הכפילות**: `isOrphanContact`
 * ‏כבר שואל את ארבעת הענפים, והוא הכלל היחיד עכשיו.
 */
describe("‏אדם שמקושר לכרטיס של עמית אינו פנוי", () => {
  const PERSON_INPUT = { name: "דנה כהן", phone: "+972501234567" };

  it("‏נדחה, למרות שאין עליו קונה, ליד או נכס", async () => {
    const built = serviceFor({ existing: true, orphan: true, linkedElsewhere: true });
    await expect(
      asUser(AGENT, () =>
        built.service.findOrCreateByPhoneTyped(txOf(built), PERSON_INPUT, {
          typedBy: "agent",
          subject: "יצירת קונה",
        }),
      ),
    ).rejects.toThrow(/משויך ללקוח שאינו נגיש לך/u);
  });

  it("‏ובלי הקישור — אותו כרטיס פנוי", async () => {
    const built = serviceFor({ existing: true, orphan: true });
    const person = await asUser(AGENT, () =>
      built.service.findOrCreateByPhoneTyped(txOf(built), PERSON_INPUT, {
        typedBy: "agent",
        subject: "יצירת קונה",
      }),
    );
    expect(person.id).toBe(HIDDEN);
  });
});
