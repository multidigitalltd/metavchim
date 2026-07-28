import type { ReactNode } from "react";

/** טקסט לקוראי מסך בלבד — מוסתר חזותית בלי display:none (שמעלים אותו גם מהם). */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="mv-visually-hidden">{children}</span>;
}
