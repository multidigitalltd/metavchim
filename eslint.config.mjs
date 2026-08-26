import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/*.config.*", "**/next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      /*
       * ‎**תלות חסרה היא סגור מיושן, ואין לה סימפטום.**
       *
       * ‎`rules-of-hooks` נכנס אחרי P1 שהפיל את כרטיס הנכס בכל
       * כניסה ראשונה — הוק אחרי החזרה מוקדמת, שעבר `lint`,
       * `typecheck` ו-`build` כי הפלאגין לא היה מותקן כלל.
       *
       * ‎`exhaustive-deps` הוא אותה משפחה בדיוק: אפקט שממשיך לקרוא
       * ערך ישן, בלי שגיאה, בלי קריסה, ובלי דרך לראות זאת בטיפוסים
       * או בבנייה. ההבדל היחיד הוא שהוא שקט.
       *
       * ‎**נכנס כשגיאה ולא כאזהרה.** שש ההפרות שהיו במאגר טופלו
       * אחת-אחת: אחת הייתה תלות חסרה אמיתית, אחת דרשה `useCallback`,
       * וארבע הן השמטות מכוונות שקיבלו `eslint-disable-next-line`
       * עם נימוק במקום. אזהרה שאיש אינו קורא היא הדרך שבה חוב חוזר.
       */
      "react-hooks/exhaustive-deps": "error",
      /*
       * `ignoreRestSiblings` ולא `varsIgnorePattern`.
       *
       * ‎`const { key: _drop, ...rest } = obj` הוא הדרך לכתוב „הכול
       * חוץ מ-key”, והכריכה בו אינה משתנה מת אלא **המנגנון** של
       * ההשמטה. הדגל הזה פוטר בדיוק את המקרה הזה — כריכה שהיא
       * אחות של `...rest` — ולא שום דבר אחר.
       *
       * ‎`varsIgnorePattern: "^_"` היה פותר את אותה שורה, אבל הוא
       * גם היה הופך „תוסיף קו תחתון” לדרך להשתיק כל משתנה מת
       * בקובץ. הכלל הזה קיים כדי לתפוס קוד מת, וכדאי שיישאר הדוק.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      /*
       * **מי עונה „כמה עולה המסלול הזה”.**
       *
       * ‎`cyclePriceAgorot` עונה מהמחירון בלבד. `effectiveCyclePriceAgorot`
       * מקדים לו את המחיר שסוכם עם המשרד — וזה המחיר שנגבה בפועל,
       * גם בפתיחת תשלום וגם בחידוש. מסך שחישב מהמחירון הציג סכום
       * אחד בזמן שהשרת גבה אחר; זה קרה שלוש פעמים בשלושה מסכים
       * שונים, ובפעם השלישית הוא גם דרס בשקט את המחיר המוסכם
       * (ביקורות Codex).
       *
       * הפונקציה נשארת — `effectiveCyclePriceAgorot` בנויה עליה, וזה
       * המקום היחיד שבו „מחיר המחירון” הוא באמת השאלה. מחוץ לחבילה
       * המשותפת אין הקשר כזה: לכל קורא יש משרד.
       */
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@metavchim/shared",
              importNames: ["cyclePriceAgorot"],
              message:
                "יש להשתמש ב-effectiveCyclePriceAgorot — המחיר המוסכם של המשרד קודם למחירון, וזה מה שייגבה.",
            },
          ],
        },
      ],
    },
  },
);
