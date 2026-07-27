import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  children: ReactNode;
}

/**
 * כפתור הבסיס של המערכת — תמיד <button> אמיתי (לא div לחיץ):
 * מקלדת, קורא מסך ו-Focus מגיעים בחינם מהסמנטיקה.
 */
export function Button({ variant = "primary", type = "button", className, children, ...rest }: ButtonProps) {
  const classes = ["mv-button", `mv-button--${variant}`, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
