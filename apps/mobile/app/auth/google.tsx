import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { parseMobileGoogleReturn, MOBILE_GOOGLE_RETURN_URL } from "@metavchim/shared";
import { useAuth } from "@/lib/auth";
import { Loading, Screen } from "@/components";

/**
 * ‏הנחיתה של `metavchim://auth/google` — לאן השרת מחזיר את הסבב מול
 * ‏Google. הפרמטרים נשפטים באותה פונקציה שמפרקת את הכתובת בדפדפן
 * ‏(`parseMobileGoogleReturn`), כדי שלא יהיו שני שופטים.
 *
 * ‏קוד — המרה ל-Session (חד-פעמית; מסך ההתחברות אולי כבר התחיל
 * ‏אותה); בהצלחה השומר ב-`_layout` מעביר לאפליקציה. שגיאה — חזרה
 * ‏למסך ההתחברות עם הסיבה, כמו `?googleError=` ב-web.
 */
export default function GoogleReturnScreen() {
  const { code, error } = useLocalSearchParams<{ code?: string; error?: string }>();
  const { loginWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const query = [
      typeof code === "string" ? `code=${encodeURIComponent(code)}` : null,
      typeof error === "string" ? `error=${encodeURIComponent(error)}` : null,
    ]
      .filter((part) => part !== null)
      .join("&");
    const outcome = parseMobileGoogleReturn(`${MOBILE_GOOGLE_RETURN_URL}?${query}`);
    if (outcome?.kind === "code") {
      loginWithGoogle(outcome.code).catch(() => {
        router.replace({ pathname: "/login", params: { googleError: "failed" } });
      });
      return;
    }
    router.replace({ pathname: "/login", params: { googleError: outcome?.error ?? "failed" } });
  }, [code, error, loginWithGoogle, router]);

  return (
    <Screen>
      <Loading label="מתחברים עם Google…" />
    </Screen>
  );
}
