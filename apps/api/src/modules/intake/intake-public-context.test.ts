import { describe, expect, it, vi } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { IntakeService } from "./intake.service";
import type { AuditService } from "../../core/audit.service";
import type { BuyersService } from "../buyers/buyers.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { PrismaService, TenantTx } from "../../core/prisma.service";

/**
 * הצד הציבורי של טופס הלקוח רץ **בלי עוגייה**, ולכן בלי הקשר דייר.
 *
 * ## למה הבדיקה הזו קיימת
 *
 * `SessionMiddleware` נכנס ל-`TenantContext.run` רק כשיש Session תקף.
 * מבקר שמגיע עם קישור בלבד אינו כזה, ולכן ה-AsyncLocalStorage **ריק**
 * לכל אורך הבקשה. `withExplicitTenant` מזריק `app.tenant_id`
 * לטרנזקציה — וזה אוכף את הבידוד — אבל הוא אינו מגדיר את ההקשר.
 *
 * חצי מהשירותים שהמסלול הזה נשען עליהם קוראים דווקא את ההקשר:
 * `ContactsService.getById` (לשם הפרטי בברכה), `AuditService.record`
 * (ליומן), ו-`BuyersService.update` (לעדכון הכרטיס). כולם קוראים
 * `TenantContext.current()`, שזורק כשאין הקשר — כלומר בלי הכריכה
 * הזו **כל** פתיחה וכל שליחה של הטופס נופלות ב-500, על אף שהטוקן
 * תקין והרשומה קיימת.
 *
 * לכן הנבדק כאן אינו „העדכון נכתב” אלא הדבר שאי אפשר לראות בקוד
 * בקריאה: שבתוך העבודה שאחרי הטוקן יש הקשר, ושהוא של הדייר של
 * הטוקן ולא של אף אחד אחר.
 */

const TENANT = "01JWAINTAKETENANTAAAAAAAAA";
const TOKEN = "a".repeat(43);

/**
 * המצב המשותף של השורה המדומה.
 *
 * `submissionRev` הוא **מספר הגרסה** של השליחה, ולכן הוא חייב להיות
 * מצב אמיתי ולא קבוע: הבדיקה של „שליחה שהוקדמה” מסתמכת בדיוק על
 * ההבדל בין מה שהתפיסה כתבה לבין מה שנקרא מתחת לנעילת הקונה.
 */
interface FakeState {
  rev: string | null;
  /** מה `findUnique` יחזיר מתחת לנעילה. `undefined` = מה שנכתב. */
  seenUnderLock?: string | null;
  buyerId?: string | undefined;
  /** מה שכבר נשלח קודם — למסלול הליד. */
  previousAnswers?: Record<string, unknown>;
  previouslySubmitted?: boolean;
  notifications: number;
}

function newState(buyerId?: string): FakeState {
  return { rev: null, buyerId, notifications: 0 };
}

/** ה-tx שהשירות מקבל — כל שאילתה מוחזרת ריקה, חוץ ממה שנדרש. */
function fakeTx(state: FakeState): TenantTx {
  const none = { findFirst: async () => null, findUnique: async () => null };
  return {
    intakeRequest: {
      ...none,
      findFirst: async () => ({
        id: "01JWAINTAKEREQUESTAAAAAAAA",
        tenantId: TENANT,
        subject: "buyer",
        subjectId: "01JWABUYERAAAAAAAAAAAAAAAA",
        contactId: "01JWACONTACTAAAAAAAAAAAAAA",
        status: "sent",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
      findUnique: async () => ({
        status: "opened",
        submittedAt: state.previouslySubmitted === true ? new Date() : null,
        answers: state.previousAnswers ?? {},
        submissionRev:
          state.seenUnderLock === undefined ? state.rev : state.seenUnderLock,
      }),
      updateMany: async (args: { data?: { submissionRev?: string } }) => {
        if (args.data?.submissionRev) state.rev = args.data.submissionRev;
        return { count: 1 };
      },
    },
    buyer:
      state.buyerId === undefined
        ? none
        : {
            ...none,
            findFirst: async () => ({ id: state.buyerId, requirements: {} }),
          },
    // נעילת איש הקשר — הגבול המשותף עם המרת הליד
    $queryRaw: async () => [],
    tenant: { findUnique: async () => ({ name: "נדל״ן ירוק" }) },
    notification: {
      create: async () => {
        state.notifications += 1;
        return {};
      },
    },
  } as unknown as TenantTx;
}

/** `PrismaService` מזויף שמעביר את שתי הפונקציות ל-`fakeTx`. */
function fakePrisma(state: FakeState): PrismaService {
  return {
    withPublicIntake: async <T>(
      _token: string,
      fn: (tx: TenantTx) => Promise<T>,
    ) => fn(fakeTx(state)),
    withExplicitTenant: async <T>(
      _tenantId: string,
      fn: (tx: TenantTx) => Promise<T>,
    ) => fn(fakeTx(state)),
  } as unknown as PrismaService;
}

/**
 * `BuyersService.update` מזויף שמתנהג כמו האמיתי במה שחשוב כאן:
 * הוא מפעיל את הפונקציה עם ה-JSON הגולמי ועם ה-`tx` שמתחת לנעילה.
 */
function fakeBuyers(
  state: FakeState,
  stored: Record<string, unknown> = {},
): { service: BuyersService; written: () => Record<string, unknown> | null } {
  let written: Record<string, unknown> | null = null;
  const service = {
    update: async (
      _id: string,
      patch: {
        requirements?:
          | Record<string, unknown>
          | ((
              current: Record<string, unknown>,
              tx: TenantTx,
            ) => Promise<Record<string, unknown>>);
      },
    ) => {
      const next =
        typeof patch.requirements === "function"
          ? await patch.requirements(stored, fakeTx(state))
          : patch.requirements;
      written = next ?? null;
    },
  } as unknown as BuyersService;
  return { service, written: () => written };
}

describe("הצד הציבורי של טופס הדרישות — הקשר דייר", () => {
  it("פתיחת הטופס בלי הקשר אינה נופלת, ורצה תחת הדייר של הטוקן", async () => {
    const seen: string[] = [];
    const contacts = {
      getById: async () => {
        // בדיוק מה שהשירות האמיתי עושה — ומה שזרק קודם
        seen.push(TenantContext.current().tenantId);
        return { id: "c", name: "דנה כהן", phone: "+972500000000" };
      },
    } as unknown as ContactsService;

    const prisma = {
      withPublicIntake: async <T>(
        _token: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx(newState())),
      withExplicitTenant: async <T>(
        _tenantId: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx(newState())),
    } as unknown as PrismaService;

    const service = new IntakeService(
      prisma,
      { record: vi.fn() } as unknown as AuditService,
      contacts,
      { update: vi.fn() } as unknown as BuyersService,
    );

    // אין `TenantContext.run` כאן בכוונה — זה בדיוק מצב הבקשה הציבורית
    expect(TenantContext.maybeCurrent()).toBeUndefined();

    const view = await service.publicView(TOKEN);
    expect(view.officeName).toBe("נדל״ן ירוק");
    expect(view.greetingName).toBe("דנה"); // שם פרטי בלבד — בלי שם משפחה
    expect(seen).toEqual([TENANT]);

    // וההקשר לא דלף החוצה: הוא חי רק בתוך העבודה שאחרי הטוקן
    expect(TenantContext.maybeCurrent()).toBeUndefined();
  });

  it("שליחה רושמת ביומן — כלומר ההקשר קיים גם במסלול הכתיבה", async () => {
    const record = vi.fn(async () => {
      TenantContext.current();
    });
    const prisma = {
      withPublicIntake: async <T>(
        _token: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx(newState())),
      withExplicitTenant: async <T>(
        _tenantId: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx(newState())),
    } as unknown as PrismaService;

    const service = new IntakeService(
      prisma,
      { record } as unknown as AuditService,
      {
        getById: async () => ({ id: "c", name: "דנה", phone: "+972500000000" }),
      } as unknown as ContactsService,
      { update: vi.fn() } as unknown as BuyersService,
    );

    await expect(service.submit(TOKEN, { dealType: "sale" })).resolves.toEqual({
      ok: true,
    });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("קישור שבוטל בין הקריאה לכתיבה — השליחה נדחית ואינה מחיה אותו", async () => {
    /*
     * `updateMany` מותנה מחזיר `count: 0` כשהשורה כבר `revoked`.
     * הכתיבה הבלתי-מותנית שהייתה כאן קודם הייתה מחזירה את הבקשה
     * למצב „נשלחה” ומחילה את התשובות על הכרטיס — אחרי שהמשרד כבר
     * אמר שהקישור אינו תקף.
     */
    const tx = fakeTx(newState());
    (tx as unknown as { intakeRequest: { updateMany: unknown } }).intakeRequest.updateMany =
      async () => ({ count: 0 });
    const update = vi.fn();
    const prisma = {
      withPublicIntake: async <T>(
        _token: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx(newState())),
      withExplicitTenant: async <T>(
        _tenantId: string,
        fn: (t: TenantTx) => Promise<T>,
      ) => fn(tx),
    } as unknown as PrismaService;

    const service = new IntakeService(
      prisma,
      { record: vi.fn() } as unknown as AuditService,
      {
        getById: async () => ({ id: "c", name: "דנה", phone: "+972500000000" }),
      } as unknown as ContactsService,
      { update } as unknown as BuyersService,
    );

    await expect(service.submit(TOKEN, { dealType: "sale" })).rejects.toThrow(
      "הקישור אינו פעיל עוד",
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe("המיזוג רץ מתחת לנעילת הכרטיס", () => {
  const BUYER = "01JWABUYERAAAAAAAAAAAAAAAA";

  function serviceFor(
    state: FakeState,
    buyers: BuyersService,
  ): IntakeService {
    return new IntakeService(
      fakePrisma(state),
      { record: vi.fn() } as unknown as AuditService,
      {
        getById: async () => ({ id: "c", name: "דנה", phone: "+972500000000" }),
      } as unknown as ContactsService,
      buyers,
    );
  }

  it("המיזוג ממזג לתוך מה שקרא מתחת לנעילה, ולא לתוך צילום ישן", async () => {
    /*
     * ערך מוכן פירושו שהמיזוג חושב **לפני** ש-`update` נעל את
     * השורה, כלומר על צילום שכבר יכול היה להשתנות — עריכה של הסוכן
     * בלשונית אחרת, או שליחה שנייה של הלקוח — והכתיבה מוחקת אותה
     * בשקט. הפונקציה נקראת אחרי הנעילה, ולכן היא רואה את מה שבאמת
     * כתוב בכרטיס באותו רגע.
     */
    const state = newState(BUYER);
    const { service: buyers, written } = fakeBuyers(state, {
      cities: ["תל אביב"],
      dealType: "sale",
      roomsMin: 4,
      features: { "custom:נוף לים": "nice" },
    });

    await serviceFor(state, buyers).submit(TOKEN, {
      dealType: "rent",
      cities: ["חיפה"],
    });

    const result = written();
    expect(result).not.toBeNull();
    expect(result!["dealType"]).toBe("rent");
    expect(result!["cities"]).toEqual(["חיפה"]);
    // מה שהטופס לא שאל עליו נשאר — כולל מאפיין מותאם של המשרד
    expect(result!["roomsMin"]).toBe(4);
    expect(result!["features"]).toEqual({ "custom:נוף לים": "nice" });
  });

  it("ערך ישן בכרטיס אינו מפיל את העדכון — הוא מוחלף בו", async () => {
    /*
     * `house` הוצע בעמוד עד לתיקון ואינו ב-`PropertyTypeSchema`.
     * אימות של **המקור** היה זורק כאן, אחרי שהבקשה כבר סומנה
     * „נשלחה” — כלומר 500 ללקוח, בלי עדכון ובלי הודעה. האימות הוא
     * על התוצאה, והתוצאה כבר נושאת את הערך התקין שהטופס שלח.
     */
    const state = newState(BUYER);
    const { service: buyers, written } = fakeBuyers(state, {
      cities: ["חיפה"],
      dealType: "sale",
      propertyTypes: ["house"],
    });

    await expect(
      serviceFor(state, buyers).submit(TOKEN, { propertyTypes: ["private_house"] }),
    ).resolves.toEqual({ ok: true });
    expect(written()!["propertyTypes"]).toEqual(["private_house"]);
  });

  it("שליחה שהוקדמה מוותרת — ואינה דורסת בתשובות ישנות", async () => {
    /*
     * התפיסה והכתיבה לכרטיס הן שתי טרנזקציות, ולכן סדר ההגעה
     * לנעילת הקונה אינו בהכרח סדר השליחות. כאן מדומה בדיוק המצב
     * הזה: מתחת לנעילה נמצאת חותמת **אחרת** מזו שהשליחה הזו כתבה,
     * כלומר מישהו הקדים אותה. היא מוותרת — בלי כתיבה ובלי התראה.
     */
    const state = newState(BUYER);
    state.seenUnderLock = "01JWANEWERSUBMISSIONAAAAAA";
    const { service: buyers, written } = fakeBuyers(state, { dealType: "sale" });

    await expect(
      serviceFor(state, buyers).submit(TOKEN, { dealType: "rent" }),
    ).resolves.toEqual({ ok: true });
    expect(written()).toBeNull();
    expect(state.notifications).toBe(0);
  });
});

describe("ליד שטרם הומר — שליחה חוזרת שמשנה תשובות מתריעה", () => {
  function serviceFor(state: FakeState, notified: () => void): IntakeService {
    return new IntakeService(
      fakePrisma(state),
      { record: vi.fn() } as unknown as AuditService,
      {
        getById: async () => ({ id: "c", name: "דנה", phone: "+972500000000" }),
      } as unknown as ContactsService,
      { update: vi.fn(notified) } as unknown as BuyersService,
    );
  }

  it("תשובות ששונו מהשליחה הקודמת מפיקות התראה", async () => {
    /*
     * לליד בלי כרטיס קונה אין „דרישות שהיו” להשוות אליהן, ולכן
     * ההשוואה היא בין שליחה לשליחה. בלעדיה כל שליחה חוזרת דיווחה
     * „לא השתנה דבר”, ו-`notify` השתיקה אותה — כלומר לקוח שתיקן את
     * תשובותיו לפני ההמרה נענה ב„נשמר”, והסוכן לא שמע דבר.
     */
    const state = newState(); // בלי כרטיס קונה — זהו ליד
    state.previouslySubmitted = true;
    state.previousAnswers = { dealType: "sale" };

    await expect(
      serviceFor(state, () => undefined).submit(TOKEN, { dealType: "rent" }),
    ).resolves.toEqual({ ok: true });
    expect(state.notifications).toBe(1);
  });

  it("שליחה חוזרת זהה נשארת שקטה", async () => {
    const state = newState();
    state.previouslySubmitted = true;
    state.previousAnswers = { dealType: "sale" };

    await expect(
      serviceFor(state, () => undefined).submit(TOKEN, { dealType: "sale" }),
    ).resolves.toEqual({ ok: true });
    expect(state.notifications).toBe(0);
  });
});
