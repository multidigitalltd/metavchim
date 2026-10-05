import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useShell } from "@/lib/shell";
import { radius, space, TOPBAR_H, type } from "@/theme";
import { Text } from "./Text";
import { makeStyles, useColors } from "@/lib/theme";

interface ScreenProps {
  title?: string;
  /** ‏כפתור או תג שיושב בשורה מתחת לכותרת (בצד ה„סוף” בפריסת RTL). */
  trailing?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** ‏מסך שמנהל גלילה בעצמו (FlatList, WebView) — בלי ScrollView מסביב. */
  scroll?: boolean;
  /** ‏מסך שורש — כפתור התפריט ולא חזרה, גם כשיש היסטוריה. */
  root?: boolean;
  /** ‏בלי ריפוד תוכן — למסך שממלא את כל השטח (WebView). */
  flush?: boolean;
  /** ‏בלי שורת הכותרת בכלל — מסכי הכניסה. */
  bare?: boolean;
}

/**
 * ‏המעטפת של כל מסך — כמו ה-web במובייל: שורת כותרת לבנה (64px) עם
 * ‏כפתור התפריט או חזרה, כותרת המסך ב-19/900, הפעמון והסוכן הקולי;
 * ‏ומתחתיה התוכן על הקנבס החם (`--mv-content-*`).
 */
export function Screen({
  title,
  trailing,
  refreshing = false,
  onRefresh,
  scroll = true,
  root = false,
  flush = false,
  bare = false,
  children,
}: PropsWithChildren<ScreenProps>) {
  const styles = useStyles();
  const c = useColors();
  const topbar = bare ? null : <TopBar title={title ?? ""} root={root} />;
  const sub = trailing ? (
    <View style={styles.trailingRow}>{trailing}</View>
  ) : null;
  if (!scroll) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        {topbar}
        {sub}
        <View style={[styles.fill, flush ? null : styles.fillPadded]}>
          {children}
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {topbar}
      <ScrollView
        contentContainerStyle={flush ? styles.flush : styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          ) : undefined
        }
      >
        {sub}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** ‏`.mv-topbar` — תפריט/חזרה, כותרת, פעמון, הסוכן הקולי. */
export function TopBar({ title, root }: { title: string; root: boolean }) {
  const styles = useStyles();
  const c = useColors();
  const router = useRouter();
  const { openDrawer, unread, hasFeature } = useShell();
  const canBack = !root && router.canGoBack();
  return (
    <View style={styles.topbar}>
      {canBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="חזרה"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="arrow-forward" size={20} color={c.text} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="תפריט"
          onPress={openDrawer}
          style={({ pressed }) => [
            styles.menuButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="menu-outline" size={20} color={c.text} />
        </Pressable>
      )}
      <Text
        style={styles.title}
        weight={900}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View style={styles.end}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unread > 0 ? `התראות, ${unread} שלא נקראו` : "התראות"
          }
          onPress={() => router.push("/notifications")}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="notifications-outline" size={20} color={c.text} />
          {unread > 0 ? <View style={styles.dot} /> : null}
        </Pressable>
        {hasFeature("voice_intake") ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="הסוכן הקולי"
            onPress={() => router.navigate("/voice")}
            style={({ pressed }) => [
              styles.voiceButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="mic-outline" size={18} color={c.onAction} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    safe: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1 },
    fillPadded: { paddingHorizontal: space.lg, paddingTop: space.md },
    content: {
      paddingHorizontal: 16,
      paddingTop: 24,
      paddingBottom: 44,
      gap: space.md,
    },
    flush: { flexGrow: 1 },
    trailingRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    topbar: {
      height: TOPBAR_H,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    menuButton: {
      minHeight: 44,
      minWidth: 44,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: c.inputBorder,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    iconButton: {
      width: 40,
      height: 40,
      borderWidth: 1,
      borderColor: c.inputBorder,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    dot: {
      position: "absolute",
      top: 7,
      right: 7,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
    },
    voiceButton: {
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: c.action,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      flex: 1,
      fontSize: type.screenTitle,
      letterSpacing: -0.4,
      color: c.text,
    },
    end: { flexDirection: "row", alignItems: "center", gap: 8 },
    pressed: { opacity: 0.8 },
  };
});
