import { describe, it, expect } from "vitest";
import {
  isSharedTabuProperty,
  SHARED_TABU_PROPERTY_TYPE,
  SHARED_TABU_ACCEPTED_NOTE,
  SHARED_TABU_REFUSED_NOTE,
  SHARED_TABU_UNKNOWN_NOTE,
  sharedTabuFit,
} from "./shared-tabu.js";
import { scoreMatch } from "./matching.js";
import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";

describe("sharedTabuFit", () => {
  it("נכס רגיל אינו מושפע מהעמדה — גם לא של מי שאישר", () => {
    for (const stance of ["accepts", "refuses", undefined] as const) {
      expect(sharedTabuFit(false, stance)).toEqual({ excluded: false, partnerable: false });
    }
  });

  it("סירוב פוסל, ואומר למה", () => {
    expect(sharedTabuFit(true, "refuses")).toEqual({
      excluded: true,
      note: SHARED_TABU_REFUSED_NOTE,
      partnerable: false,
    });
  });

  it("אישור אינו פוסל, ופותח שותפות", () => {
    expect(sharedTabuFit(true, "accepts")).toEqual({
      excluded: false,
      note: SHARED_TABU_ACCEPTED_NOTE,
      partnerable: true,
    });
  });

  it("‏„טרם נשאל” מציג ואינו פוסל — אבל אינו נכנס לשותפות", () => {
    expect(sharedTabuFit(true, undefined)).toEqual({
      excluded: false,
      note: SHARED_TABU_UNKNOWN_NOTE,
      partnerable: false,
    });
  });
});

const PROPERTY: PropertyFields = {
  city: "חולון",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  priceAgorot: 200_000_000,
  sharedTabu: true,
};

const BUYER: BuyerRequirements = {
  cities: ["חולון"],
  neighborhoods: [],
  searchAreas: [],
  dealType: "sale",
  propertyTypes: ["apartment"],
  budgetMaxAgorot: 200_000_000,
  roomsMin: 3.5,
  roomsMax: 4.5,
  features: {},
};

describe("השער בתוך scoreMatch", () => {
  it("קונה שסירב אינו מקבל את הנכס, וההסבר נוקב בסיבה", () => {
    const result = scoreMatch(PROPERTY, { ...BUYER, sharedTabu: "refuses" });
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
    expect(result.explanation).toBe(SHARED_TABU_REFUSED_NOTE);
    /* ‏„בדקנו ולא מתאים” ולא „לא היה מה לבדוק” */
    expect(result.insufficientData).toBe(false);
  });

  it("הסירוב גובר על חוסם משוקלל — עיר שגויה אינה מסתירה את הסיבה האמיתית", () => {
    const result = scoreMatch(
      { ...PROPERTY, city: "אילת" },
      { ...BUYER, sharedTabu: "refuses" },
    );
    expect(result.explanation).toBe(SHARED_TABU_REFUSED_NOTE);
  });

  it("קונה שאישר מקבל את הנכס, וההערה מופיעה ראשונה בהסבר", () => {
    const result = scoreMatch(PROPERTY, { ...BUYER, sharedTabu: "accepts" });
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.explanation.startsWith(SHARED_TABU_ACCEPTED_NOTE)).toBe(true);
  });

  it("קונה שלא נשאל מקבל את הנכס — ואת השאלה", () => {
    const result = scoreMatch(PROPERTY, BUYER);
    expect(result.excluded).toBe(false);
    expect(result.explanation.startsWith(SHARED_TABU_UNKNOWN_NOTE)).toBe(true);
  });

  it("נכס שאינו בטאבו משותף אינו מזכיר אותו כלל", () => {
    const result = scoreMatch({ ...PROPERTY, sharedTabu: false }, { ...BUYER, sharedTabu: "accepts" });
    expect(result.explanation).not.toContain("טאבו משותף");
  });

  it("‏השער אינו נספר בציון: אישור וחוסר-ידיעה נותנים אותו מספר", () => {
    /*
     * ‏המבחן שמפיל רכיב במשקל אפס: אילו ההערה הייתה `ScoreComponent`
     * ‏היא הייתה נכנסת לנרמול ולכיסוי, ושני המצבים היו מתפצלים.
     */
    const accepted = scoreMatch(PROPERTY, { ...BUYER, sharedTabu: "accepts" });
    const unknown = scoreMatch(PROPERTY, BUYER);
    expect(accepted.score).toBe(unknown.score);
    expect(accepted.coverage).toBe(unknown.coverage);
    expect(accepted.breakdown.length).toBe(unknown.breakdown.length);
  });
});

/**
 * ‎**שני מקורות לעובדה אחת — ושתי הדליפות ההפוכות שלהם** (ביקורת Codex, P1).
 *
 * ‏`shared_tabu` יושב ב-`PropertyTypeSchema` מלפני הדגל, ומחלץ
 * ‏ההקלטה וייבוא ה-CSV עדיין מייצרים אותו.
 */
describe("‏הסוג הוותיק והדגל — שאלה אחת", () => {
  it("נכס שנרשם בסוג הוותיק נחשב לרשום בטאבו משותף", () => {
    expect(isSharedTabuProperty({ propertyType: SHARED_TABU_PROPERTY_TYPE })).toBe(true);
  });

  it("והמנוע פוסל מולו קונה שסירב — גם בלי הדגל", () => {
    const result = scoreMatch(
      { ...PROPERTY, sharedTabu: false, propertyType: SHARED_TABU_PROPERTY_TYPE },
      { ...BUYER, propertyTypes: [SHARED_TABU_PROPERTY_TYPE], sharedTabu: "refuses" },
    );
    expect(result.excluded).toBe(true);
    expect(result.explanation).toBe(SHARED_TABU_REFUSED_NOTE);
  });

  /*
   * ‏הכיוון השני, וזה שהיה שבור: דירה שסומן עליה הדגל **נפסלה**
   * ‏מקונה שביקש את הסוג הוותיק, כי „דירה” אינו ברשימת הסוגים שלו.
   */
  it("קונה שביקש את הסוג הוותיק מקבל דירה שסומן עליה הדגל", () => {
    const result = scoreMatch(
      { ...PROPERTY, propertyType: "apartment", sharedTabu: true },
      { ...BUYER, propertyTypes: [SHARED_TABU_PROPERTY_TYPE], sharedTabu: "accepts" },
    );
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it("ופנטהאוז בטאבו משותף עונה על אותה בקשה", () => {
    const result = scoreMatch(
      { ...PROPERTY, propertyType: "penthouse", sharedTabu: true },
      { ...BUYER, propertyTypes: [SHARED_TABU_PROPERTY_TYPE], sharedTabu: "accepts" },
    );
    expect(result.excluded).toBe(false);
  });

  /*
   * ‏אבל הכיוון ההפוך נשאר פסילה: נכס שנרשם בסוג הוותיק מול קונה
   * ‏שביקש „דירה” — סוגו של הנכס פשוט אינו ידוע, ולנחש „דירה” היה
   * ‏להמציא עובדה.
   */
  it("נכס בסוג הוותיק אינו נחשב אוטומטית „דירה”", () => {
    const result = scoreMatch(
      { ...PROPERTY, propertyType: SHARED_TABU_PROPERTY_TYPE },
      { ...BUYER, propertyTypes: ["apartment"], sharedTabu: "accepts" },
    );
    expect(result.excluded).toBe(true);
  });

  it("והדגל אינו הופך נכס רגיל למבוקש על ידי מי שלא ביקש אותו", () => {
    const result = scoreMatch(
      { ...PROPERTY, propertyType: "penthouse", sharedTabu: true },
      { ...BUYER, propertyTypes: ["apartment"], sharedTabu: "accepts" },
    );
    expect(result.excluded).toBe(true);
  });
});
