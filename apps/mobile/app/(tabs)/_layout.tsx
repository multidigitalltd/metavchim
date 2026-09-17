import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
}

/**
 * ‏חמש הלשוניות — מה שהמתווך פותח בשטח, ולא כל המערכת. השאר ב„עוד”.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: font.xs - 2, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="today" options={{ title: "היום", tabBarIcon: icon("sunny-outline") }} />
      <Tabs.Screen name="leads" options={{ title: "לידים", tabBarIcon: icon("call-outline") }} />
      <Tabs.Screen
        name="properties"
        options={{ title: "נכסים", tabBarIcon: icon("home-outline") }}
      />
      <Tabs.Screen name="buyers" options={{ title: "לקוחות", tabBarIcon: icon("people-outline") }} />
      <Tabs.Screen
        name="more"
        options={{ title: "עוד", tabBarIcon: icon("ellipsis-horizontal-outline") }}
      />
    </Tabs>
  );
}
