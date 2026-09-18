import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { StyleSheet, useColorScheme } from "react-native";
import {
  chrome,
  colors as lightColors,
  darkChrome,
  darkColors,
  darkShadowCard,
  shadowCard as lightShadowCard,
  type Palette,
} from "@/theme";

/**
 * ‏ערכת הנושא — בהיר / כהה / אוטומטי לפי המכשיר, בדיוק כמו בורר הערכה
 * ‏ב-web (`theme-toggle.tsx`): אותם שלושה מצבים, אותו מפתח אחסון
 * ‏(`mv-theme`), ואותן ערכות צבע (`--dk-*` ב-`globals.css`).
 *
 * ‏„אוטומטי” עוקב אחרי מצב הלילה של המכשיר בלי לזכור בחירה. הבחירה
 * ‏נשמרת במכשיר בלבד — ב-web היא ב-localStorage של הדפדפן, וכאן
 * ‏ב-AsyncStorage; המסכים המוטמעים מקבלים אותה מהאפליקציה (ראו
 * ‏`themeBridgeScript`), כך שהמערכת כולה נראית אותו דבר בתוך האפליקציה.
 */
export type ThemeChoice = "light" | "dark" | "auto";
export type Scheme = "light" | "dark";

/** ‏אותו מפתח כמו ב-web — מי שקורא את שניהם מבין מיד שזו אותה בחירה. */
export const THEME_STORAGE_KEY = "mv-theme";

export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: "בהיר",
  dark: "כהה",
  auto: "אוטומטי",
};

export interface Theme {
  choice: ThemeChoice;
  setChoice(choice: ThemeChoice): void;
  /** ‏הערכה בפועל — הבחירה, או המכשיר כשהבחירה „אוטומטי”. */
  scheme: Scheme;
  colors: Palette;
  /** ‏הערכים שאינם טוקנים (`chrome` ב-`theme.ts`), עם גווני השורה לפי הערכה. */
  chrome: Chrome;
  shadowCard: typeof lightShadowCard | typeof darkShadowCard;
}

type Chrome = {
  readonly [
    K in keyof typeof chrome
  ]: (typeof chrome)[K] extends readonly string[] ? (typeof chrome)[K] : string;
};

const ThemeContext = createContext<Theme | null>(null);

function isChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "auto";
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const device = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>("auto");

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isChoice(stored)) setChoiceState(stored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    // ‏„אוטומטי” = בלי בחירה שמורה, כמו ב-web
    void (
      next === "auto"
        ? AsyncStorage.removeItem(THEME_STORAGE_KEY)
        : AsyncStorage.setItem(THEME_STORAGE_KEY, next)
    ).catch(() => undefined);
  }, []);

  const scheme: Scheme =
    choice === "auto" ? (device === "dark" ? "dark" : "light") : choice;

  const value = useMemo<Theme>(
    () => ({
      choice,
      setChoice,
      scheme,
      colors: scheme === "dark" ? darkColors : lightColors,
      chrome: scheme === "dark" ? { ...chrome, ...darkChrome } : chrome,
      shadowCard: scheme === "dark" ? darkShadowCard : lightShadowCard,
    }),
    [choice, setChoice, scheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme מחוץ ל-ThemeProvider");
  return ctx;
}

/** ‏הערכה הנוכחית בלבד — לצבע בודד בתוך JSX (סמל, מחוון). */
export function useColors(): Palette {
  return useTheme().colors;
}

type NamedStyles<T> = {
  [P in keyof T]:
    | import("react-native").ViewStyle
    | import("react-native").TextStyle
    | import("react-native").ImageStyle;
};

/**
 * ‏`StyleSheet.create` שתלוי בערכה: מחזיר hook שבונה את הסגנונות פעם
 * ‏אחת לכל ערכה. במקום `const styles = StyleSheet.create({...colors...})`
 * ‏ברמת המודול — `const useStyles = makeStyles((c) => ({...c...}))`
 * ‏ובתוך הרכיב `const styles = useStyles()`.
 */
export function makeStyles<T extends NamedStyles<T>>(
  factory: (theme: Theme) => T,
): () => T {
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
  };
}

/**
 * ‏הסקריפט שמסנכרן את הבחירה אל ה-web המוטמע: שומר את הבחירה במפתח
 * ‏של ה-web (כך הבורר בעמוד הפרופיל מציג אותה), קובע את הערכה בפועל
 * ‏על `<html>` (הבהיר/כהה שהאפליקציה החליטה — גם ב„אוטומטי”, כי
 * ‏`prefers-color-scheme` ב-WebView אינו תמיד המכשיר), ומדווח חזרה
 * ‏לאפליקציה כשהמשתמש בוחר ערכה מתוך העמוד.
 */
export function themeBridgeScript(choice: ThemeChoice, scheme: Scheme): string {
  const stored =
    choice === "auto"
      ? `localStorage.removeItem("${THEME_STORAGE_KEY}")`
      : `localStorage.setItem("${THEME_STORAGE_KEY}","${choice}")`;
  return `(function(){try{${stored}}catch(e){}
function apply(){var r=document.documentElement;if(r)r.setAttribute("data-theme","${scheme}")}
apply();
if(!window.__mvThemeBridge){window.__mvThemeBridge=true;
document.addEventListener("DOMContentLoaded",apply);
window.addEventListener("mv-theme-change",function(e){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:"theme",value:e.detail}))}catch(x){}});}
})();true;`;
}

/** ‏הודעה מה-web המוטמע — בחירת ערכה מתוך עמוד הפרופיל. */
export function parseThemeMessage(raw: string): ThemeChoice | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { type?: unknown }).type === "theme"
    ) {
      const value = (data as { value?: unknown }).value;
      return isChoice(value) ? value : null;
    }
  } catch {
    // ‏לא JSON — לא שלנו
  }
  return null;
}
