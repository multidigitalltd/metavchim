"use client";

import { useRouter } from "next/navigation";
import { readinessFieldLabel } from "@metavchim/shared";
import { READINESS_ADVICE } from "@/lib/readiness";
import { IconPlus } from "../../icons";
import { openReadinessField } from "./readiness-card";

/**
 * ‎**„מה כדאי להשלים” — הסיבה, ולא רק החוסר.**
 *
 * ## מה זה מוסיף על מה שכבר במסך
 *
 * הרשת שבכרטיס אומרת „חסר”, והרצועה שבכותרת אומרת „7 שדות חסרים”.
 * שתיהן מדווחות מצב ואף אחת אינה עונה על „למה שאכפת לי” — וזו
 * השאלה שמכריעה אם מתווך עוצר וממלא או ממשיך הלאה. „בלי מחיר הנכס
 * אינו נכנס להתאמות” הוא משפט שגורם למלא; „חסר מחיר” אינו.
 *
 * ## למה כפתור ולא תיבת סימון
 *
 * במוקאפ יש תיבת סימון לצד כל שורה, והיא הייתה שקר קטן: אין כאן מה
 * לסמן — הפריט יורד מהרשימה כשהשדה מתמלא, ולא כשמסמנים אותו. תיבה
 * שאי אפשר לסמן היא פקד מת, ותיבה שאפשר הייתה יוצרת מצב שני שאינו
 * קיים בנתונים. העיגול הוא סימן מצב, והשורה כולה היא הכפתור.
 *
 * ## ולמה ארבעה
 *
 * נכס חדש חסר בכל תשעת השדות, ורשימה של תשעה פריטים „כדאי” היא
 * רשימת מטלות ולא המלצה. הסדר הוא של `PROPERTY_READINESS_FIELDS`,
 * כלומר אותו סדר שבו התאים מוצגים — ומי שרוצה את כולם רואה אותם שם.
 */
const SHOWN = 4;

export function SuggestionsCard({
  propertyId,
  missingFields,
  onSelectTab,
  onScrollToSection,
}: {
  propertyId: string;
  /**
   * ‎**מחרוזות, ולא הטיפוס.** ה-DTO אינו נושא אותו, ולכן שדה
   * שאינו מוכר — גרסת שרת חדשה יותר, למשל — פשוט אינו מוצג. הוא
   * עדיין נספר במוכנות ומופיע ברשת; מה שאין לו נימוק כתוב אינו
   * מקבל שורה שבה הנימוק ריק.
   */
  missingFields: readonly string[];
  onSelectTab: (tab: string) => void;
  onScrollToSection: (id: string) => void;
}) {
  const router = useRouter();
  const shown = missingFields
    .flatMap((field) => {
      const advice = READINESS_ADVICE[field as keyof typeof READINESS_ADVICE];
      return advice === undefined ? [] : [{ field, advice }];
    })
    .slice(0, SHOWN);

  // הכל מלא — אין המלצה, ואין כרטיס. „מצוין!” ריק הוא רעש.
  if (shown.length === 0) return null;

  return (
    <section className="mv-card" aria-labelledby="suggestions-heading">
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44 mv-domain-green" aria-hidden="true">
          <IconPlus s={20} />
        </span>
        <h2 id="suggestions-heading" className="mv-card-head__title">
          מה כדאי להשלים
        </h2>
      </div>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {shown.map(({ field, advice }) => {
          return (
            <li key={field}>
              <button
                type="button"
                className="flex w-full items-start gap-3 rounded-[14px] px-3.5 py-3 text-start"
                style={{
                  background: "var(--color-surface-sunken)",
                  border: "1px solid var(--color-input-border)",
                  cursor: "pointer",
                  /* ‎44px שטח נגיעה — DESIGN-SYSTEM-2 §10 */
                  minHeight: 44,
                }}
                /*
                  התווית נושאת את שם השדה: ארבע שורות שכולן „להשלים”
                  הן ארבעה כפתורים זהים למי שאינו רואה את הטקסט.
                */
                aria-label={`${advice.action} — ${readinessFieldLabel(field)}`}
                onClick={() =>
                  openReadinessField({
                    router,
                    propertyId,
                    field,
                    onSelectTab,
                    onScrollToSection,
                  })
                }
              >
                {/*
                  סימן מצב ולא פקד — ראו ההערה בראש הקובץ.
                  ‎`aria-hidden`: הוא אומר „טרם הושלם”, וזו כבר
                  המשמעות של הופעה ברשימה הזו.
                */}
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex-none rounded-full"
                  style={{
                    width: 18,
                    height: 18,
                    border: "2px solid var(--color-input-border)",
                  }}
                />
                <span className="flex flex-col gap-0.5">
                  <span style={{ fontSize: "var(--type-body-sm)", fontWeight: 800 }}>
                    {advice.action}
                  </span>
                  <span
                    style={{
                      fontSize: "var(--type-caption)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {advice.why}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
