import { describe, expect, it } from "vitest";
import { PROPERTY_TYPE_LABELS_HE } from "./csv-export.js";
import { clientPropertyTitle } from "./property-title.js";

describe("שם הנכס שיוצא ללקוח", () => {
  it("הכותרת השיווקית מנצחת כשיש אחת", () => {
    expect(clientPropertyTitle({ marketingTitle: "פנינה מול הים", propertyType: "apartment", rooms: 4, city: "חולון" })).toBe(
      "פנינה מול הים",
    );
  });

  it("כותרת של רווחים בלבד אינה כותרת", () => {
    expect(clientPropertyTitle({ marketingTitle: "   ", propertyType: "apartment", rooms: 4, city: "חולון" })).toBe(
      "דירת 4 חדרים בחולון",
    );
  });

  /*
   * ‏זו התקלה שנמצאה בבדיקה החיה: הלקוח קיבל מייל שנושאו
   * ‏„apartment — שם המשרד”.
   */
  it("לעולם לא ערך גולמי של סוג הנכס", () => {
    for (const type of Object.keys(PROPERTY_TYPE_LABELS_HE)) {
      const title = clientPropertyTitle({ propertyType: type, rooms: 3, city: "חולון" });
      expect(title, type).not.toContain(type);
      expect(title, type).toMatch(/^[֐-׿]/u);
    }
  });

  it("סוג הנכס בעברית — פנטהאוז אינו „דירה”", () => {
    expect(clientPropertyTitle({ propertyType: "penthouse", rooms: 5, city: "חולון" })).toBe("פנטהאוז 5 חדרים בחולון");
  });

  it("בלי חדרים — הסוג והעיר בלבד", () => {
    expect(clientPropertyTitle({ propertyType: "apartment", city: "חולון" })).toBe("דירה בחולון");
    expect(clientPropertyTitle({ propertyType: "plot", rooms: 0, city: "חולון" })).toBe(
      `${PROPERTY_TYPE_LABELS_HE.plot} בחולון`,
    );
  });

  it("בלי עיר ובלי סוג — „נכס”", () => {
    expect(clientPropertyTitle({})).toBe("נכס");
    expect(clientPropertyTitle({ rooms: 3 })).toBe("נכס 3 חדרים");
  });

  it("חצאי חדרים נשמרים", () => {
    expect(clientPropertyTitle({ propertyType: "apartment", rooms: 3.5, city: "בת ים" })).toBe("דירת 3.5 חדרים בבת ים");
  });

  it("סוג שאינו בקטלוג אינו דולף", () => {
    expect(clientPropertyTitle({ propertyType: "warehouse_of_doom", rooms: 2, city: "חולון" })).toBe("נכס 2 חדרים בחולון");
  });
});
