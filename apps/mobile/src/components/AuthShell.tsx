import type { PropsWithChildren, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { chrome, space, type } from "@/theme";
import { Logo } from "./Logo";
import { Text } from "./Text";
import { makeStyles } from "@/lib/theme";

/**
 * ‏המעטפת של מסכי הכניסה — `AuthShell` של ה-web: לוח המותג הירוק עם
 * ‏הלוגו, ההבטחה ושלוש הנקודות, ומתחתיו הכרטיס עם הטופס. במובייל
 * ‏של ה-web שניהם בעמודה אחת, וכך גם כאן.
 */
export function AuthShell({
  title,
  subtitle,
  points = DEFAULT_POINTS,
  onBrandLongPress,
  foot,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  points?: readonly string[];
  /** ‏לחיצה ארוכה על הלוגו — כניסה נסתרת להגדרות המתקדמות (כתובת השרת). */
  onBrandLongPress?: () => void;
  foot?: ReactNode;
}>) {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <LinearGradient
            colors={[...chrome.authGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.6, y: 1 }}
            style={styles.brand}
          >
            <Pressable
              onLongPress={onBrandLongPress}
              delayLongPress={1500}
              accessibilityRole="header"
              style={styles.logo}
            >
              <Logo size={26} wordmark={21} />
            </Pressable>
            <Text style={styles.h1} weight={900}>
              המתווך סוגר עסקאות. המערכת מטפלת בכל השאר.
            </Text>
            <Text style={styles.lead}>
              מערכת ניהול למשרדי תיווך בישראל — נכסים, קונים, התאמות והצעות
              במקום אחד.
            </Text>
            <View style={styles.points}>
              {points.map((point) => (
                <View key={point} style={styles.point}>
                  <Text style={styles.check} weight={900}>
                    ✓
                  </Text>
                  <Text style={styles.pointText}>{point}</Text>
                </View>
              ))}
            </View>
          </LinearGradient>
          <View style={styles.panel}>
            <Text style={styles.title} weight={800} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
            {children}
            {foot ? <View style={styles.foot}>{foot}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const DEFAULT_POINTS = [
  "התאמת קונים לנכסים — עם הסבר לכל התאמה",
  "הצעות בוואטסאפ בלחיצה, ודף נחיתה לכל נכס",
  "רשת שיתופי פעולה בין משרדים — ביקושים והפניות לקוחות",
] as const;

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    safe: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1 },
    scroll: { flexGrow: 1 },
    brand: { paddingHorizontal: 26, paddingVertical: 28, gap: 14 },
    logo: { alignSelf: "flex-start" },
    h1: { color: "#ffffff", fontSize: 30, lineHeight: 35, letterSpacing: -0.6 },
    lead: {
      color: "rgba(255, 255, 255, 0.88)",
      fontSize: type.body,
      lineHeight: 25,
    },
    points: { gap: 9, marginTop: 6 },
    point: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
    check: { color: c.action, fontSize: type.captionLg, lineHeight: 21 },
    pointText: {
      flex: 1,
      color: "rgba(255, 255, 255, 0.92)",
      fontSize: type.captionLg,
      lineHeight: 21,
    },
    panel: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 40, gap: 6 },
    title: { fontSize: 23, lineHeight: 30, marginBottom: 4 },
    sub: { color: c.textMuted, fontSize: type.captionLg, marginBottom: 14 },
    foot: { marginTop: space.lg, alignItems: "center" },
  };
});
