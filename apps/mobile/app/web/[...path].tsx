import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Linking, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { apiOrigin } from "@/lib/config";
import { webScreenTitle } from "@/lib/nav";
import { useShell } from "@/lib/shell";
import { ErrorState, Loading, Screen } from "@/components";
import { colors } from "@/theme";

/**
 * ‏מסך של המערכת בתוך האפליקציה — **ה-web עצמו**, בלי המעטפת שלו.
 *
 * ‏מה שאין לו מסך נייטיבי (הגדרות, דוחות, יומן, הצעות, הפורום,
 * ‏המנטור, הפלטפורמה…) מוצג כאן מתוך `app.metavchim.co.il`, באותו
 * ‏עיצוב ובאותה התנהגות כמו במובייל של הדפדפן. שורת הכותרת, הפעמון
 * ‏והתפריט הם של האפליקציה; ה-web מסתיר את שלו (עוגיית `mv_embedded`).
 *
 * ‏ה-Session: ה-web מדבר עם ה-API בעוגייה, והאפליקציה מחזיקה Bearer.
 * ‏בפתיחה הראשונה (לכל התחברות) האפליקציה מבקשת קוד חד-פעמי
 * ‏(`POST /auth/web-session`) ופותחת את כתובת הנחיתה שמכניסה את
 * ‏**אותו** Session לעוגייה ומפנה למסך. מכאן ואילך העוגייה חיה בצנצנת
 * ‏של ה-WebView ומסכים נוספים נפתחים ישירות.
 */

/**
 * ‏למי כבר נמסר Session לדפדפן המוטמע — מזהה המשתמש, ומקור ה-web שהשרת
 * ‏החזיר. בייצור מקור ה-web הוא מקור ה-API (Caddy), אבל בפיתוח ה-API
 * ‏ב-3001 וה-web ב-3000 — והאפליקציה מכירה מעצמה רק את ה-API.
 */
let handedOff: { userId: string; webOrigin: string } | null = null;

/** ‏קישורים שיוצאים מהאפליקציה: חיוג, וואטסאפ, מייל, וכל מארח שאינו שלנו. */
function isExternal(url: string, origins: readonly string[]): boolean {
  if (url.startsWith("about:")) return false;
  return !origins.some((origin) => url === origin || url.startsWith(`${origin}/`));
}

export default function WebScreen() {
  const params = useLocalSearchParams<{ path?: string | string[] } & Record<string, string | string[]>>();
  const { user, refresh } = useAuth();
  const { refreshCounts } = useShell();
  const origin = apiOrigin();
  const [webOrigin, setWebOrigin] = useState<string>(handedOff?.webOrigin ?? origin);
  const webview = useRef<WebView>(null);
  const [initialUrl, setInitialUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /*
   * ‏הנתיב במערכת: המקטעים אחרי `/web`, הפרמטרים הנוספים כמחרוזת שאילתה,
   * ‏והעוגן — ש-expo-router חושף כפרמטר בשם `#` — חוזר למקומו בסוף,
   * ‏אחרי השאילתה (`/settings#virtual-numbers`, ולא `?%23=…`).
   */
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const pathname = segments.length === 1 && segments[0] === "home" ? "/" : `/${segments.join("/")}`;
  const query = Object.entries(params)
    .filter(([key, value]) => key !== "path" && key !== "#" && typeof value === "string")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
    .join("&");
  const hash = typeof params["#"] === "string" && params["#"] !== "" ? `#${params["#"]}` : "";
  const target = `${pathname}${query ? `?${query}` : ""}${hash}`;
  const title = webScreenTitle(pathname);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setInitialUrl(null);
    if (user && handedOff?.userId === user.id) {
      setWebOrigin(handedOff.webOrigin);
      setInitialUrl(`${handedOff.webOrigin}${target}`);
      return;
    }
    apiPost<{ code: string; webOrigin?: string }>("/auth/web-session", {})
      .then(({ code, webOrigin: served }) => {
        if (cancelled) return;
        // ‏שרת ישן שאינו מחזיר מקור — הנחת הייצור: אותו מקור כמו ה-API
        const web = (served ?? origin).replace(/\/+$/u, "");
        if (user) handedOff = { userId: user.id, webOrigin: web };
        setWebOrigin(web);
        // ‏הנחיתה היא נתיב של ה-API; היא מפנה משם למקור של ה-web
        setInitialUrl(`${origin}/api/v1/auth/web-session/${code}?next=${encodeURIComponent(target)}`);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "לא הצלחנו לפתוח את המסך");
      });
    return () => {
      cancelled = true;
    };
  }, [origin, target, user, attempt]);

  // ‏כפתור „חזרה” של אנדרואיד — קודם בתוך העמוד, ורק אז מהמסך
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webview.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const onNavigation = useCallback(
    (state: WebViewNavigation) => {
      setCanGoBack(state.canGoBack);
      /*
       * ‏ה-web הפנה למסך ההתחברות — ה-Session נגמר (התנתקות מתוך
       * ‏המסך, ביטול ממכשיר אחר, תפוגה). האפליקציה בודקת בעצמה:
       * ‏`refresh` מקבל 401 ומנקה, והשומר מציג את מסך ההתחברות שלה.
       */
      if (state.url.startsWith(`${webOrigin}/login`)) {
        handedOff = null;
        void refresh();
        return;
      }
      // ‏פעולה במסך web (קליטת ליד, סימון משימה) — התגים במגירה מתעדכנים
      if (!state.loading) refreshCounts();
    },
    [webOrigin, refresh, refreshCounts],
  );

  return (
    <Screen title={title} scroll={false} flush>
      {error ? (
        <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : initialUrl === null ? (
        <Loading />
      ) : (
        <WebView
          ref={webview}
          key={`${initialUrl}#${attempt}`}
          source={{ uri: initialUrl }}
          style={styles.web}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          mediaCapturePermissionGrantType="grant"
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <Loading />
            </View>
          )}
          onNavigationStateChange={onNavigation}
          onShouldStartLoadWithRequest={(request) => {
            if (isExternal(request.url, [origin, webOrigin])) {
              void Linking.openURL(request.url).catch(() => undefined);
              return false;
            }
            return true;
          }}
          onError={(event) => setError(event.nativeEvent.description || "המסך לא נטען — בדקו את הרשת")}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 500) setError("השרת החזיר שגיאה — נסו שוב");
          }}
          onOpenWindow={(event) => {
            void Linking.openURL(event.nativeEvent.targetUrl).catch(() => undefined);
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: colors.bg },
  loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.bg },
});
