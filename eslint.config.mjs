import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/*.config.*", "**/next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
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
    },
  },
);
