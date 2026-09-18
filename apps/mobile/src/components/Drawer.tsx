import { useEffect, useRef } from "react";
import { Animated, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { ROLE_LABELS, type UserRole } from "@metavchim/shared";
import { useAuth } from "@/lib/auth";
import { apiOrigin } from "@/lib/config";
import { family } from "@/lib/fonts";
import { NAV_ITEMS, navVisible, routeFor, type NavItem, type NavTag } from "@/lib/nav";
import { useShell } from "@/lib/shell";
import { chrome, colors, radius, space, type } from "@/theme";
import { Logo } from "./Logo";
import { Text } from "./Text";

const WIDTH = 250;

const TAG_TEXT: Record<NavTag, string> = { soon: "בקרוב", beta: "בטא", ai: "AI" };

/**
 * ‏המגירה — `.mv-sidebar--drawer` של ה-web במובייל: לוח כהה 250px
 * ‏שנשלף מימין מעל שכבת כיסוי, הלוגו ושם המשרד, רשימת הניווט עם
 * ‏מונים ותגים, והמשתמש בתחתית.
 */
export function Drawer() {
  const { drawerOpen, closeDrawer, summary } = useShell();
  const { user } = useAuth();
  const router = useRouter();
  const slide = useRef(new Animated.Value(WIDTH)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: drawerOpen ? 0 : WIDTH,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, slide]);

  function open(item: NavItem) {
    closeDrawer();
    if (item.external) {
      void Linking.openURL(`${apiOrigin()}${item.href}`);
      return;
    }
    router.navigate(routeFor(item.href));
  }

  const role = user?.role as UserRole | undefined;
  const initials = (user?.name ?? "")
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");

  return (
    <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={closeDrawer}>
      <View style={styles.scrimWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel="סגירת התפריט" style={styles.scrim} onPress={closeDrawer} />
        <Animated.View style={[styles.panel, { transform: [{ translateX: slide }] }]}>
          <SafeAreaView style={styles.fill} edges={["top", "bottom", "right"]}>
            <View style={styles.head}>
              <Logo />
              <Text style={styles.tenant}>{user?.tenantName ?? " "}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.nav} accessibilityRole="menu">
              {NAV_ITEMS.filter((item) => navVisible(item, user ?? null, summary)).map((item) => {
                const count = summary && item.count ? item.count(summary) : 0;
                const badge = summary && item.badge ? item.badge(summary) : 0;
                return (
                  <Pressable
                    key={item.href}
                    accessibilityRole="menuitem"
                    onPress={() => open(item)}
                    style={({ pressed }) => [styles.link, item.sub && styles.subLink, pressed && styles.linkPressed]}
                  >
                    {item.sub ? null : (
                      <Ionicons name={item.icon as never} size={17} color={chrome.sidebarFg} />
                    )}
                    <Text style={styles.label} weight={600} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {count > 0 ? <Text style={styles.count}>{count}</Text> : null}
                    {badge > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText} weight={700}>
                          {badge}
                        </Text>
                      </View>
                    ) : null}
                    {item.tag ? (
                      <View style={[styles.tag, item.tag === "ai" && styles.tagAi]}>
                        <Text style={styles.tagText} weight={700}>
                          {TAG_TEXT[item.tag]}
                        </Text>
                      </View>
                    ) : null}
                    {item.external ? <Text style={styles.count}>↗</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`הפרופיל של ${user?.name ?? ""}`}
              onPress={() => {
                closeDrawer();
                router.navigate("/app-settings");
              }}
              style={({ pressed }) => [styles.user, pressed && styles.linkPressed]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText} weight={700}>
                  {initials}
                </Text>
              </View>
              <View style={styles.userMain}>
                <Text style={styles.userName} weight={700} numberOfLines={1}>
                  {user?.name ?? ""}
                </Text>
                <Text style={styles.userRole} numberOfLines={1}>
                  {role === undefined ? "" : (ROLE_LABELS[role] ?? role)}
                </Text>
              </View>
              <Ionicons name="settings-outline" size={16} color={chrome.sidebarMuted} />
            </Pressable>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrimWrap: { flex: 1, flexDirection: "row-reverse" },
  scrim: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.45)" },
  panel: { width: WIDTH, backgroundColor: chrome.sidebarBg, paddingBottom: 14 },
  head: { padding: 22, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: chrome.sidebarLine, gap: 5 },
  tenant: { color: chrome.sidebarMuted, fontSize: type.caption, minHeight: 18 },
  nav: { paddingVertical: 10, paddingHorizontal: 10, gap: 2 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  subLink: { paddingRight: 39 },
  linkPressed: { backgroundColor: chrome.sidebarActiveBg },
  label: { flex: 1, color: chrome.sidebarFg, fontSize: type.body },
  count: { color: chrome.sidebarMuted, fontSize: type.caption, fontFamily: family(700) },
  badge: { backgroundColor: chrome.badgeBg, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 1 },
  badgeText: { color: chrome.badgeFg, fontSize: type.caption, lineHeight: 18 },
  tag: {
    borderWidth: 1,
    borderColor: colors.action,
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  tagAi: { borderColor: "#c9baf0" },
  tagText: { color: colors.action, fontSize: 12, lineHeight: 16 },
  user: {
    marginHorizontal: 12,
    padding: 12,
    backgroundColor: chrome.sidebarUserBg,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.action,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onAction, fontSize: 13, lineHeight: 16, textAlign: "center" },
  userMain: { flex: 1, minWidth: 0 },
  userName: { color: chrome.sidebarFg, fontSize: type.bodySm },
  userRole: { color: chrome.sidebarMuted, fontSize: 12.5, lineHeight: 16 },
});

export const DRAWER_WIDTH = WIDTH;
export { space as drawerSpace };
