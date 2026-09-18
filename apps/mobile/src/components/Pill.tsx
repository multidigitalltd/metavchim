import { StyleSheet, View } from "react-native";
import { colors, radius, space, type } from "@/theme";
import { Text } from "./Text";

export type Tone = "neutral" | "success" | "amber" | "danger" | "primary";

const TONES: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.chipNeutralFg, bg: colors.chipNeutralBg },
  success: { fg: colors.success, bg: colors.successSoft },
  amber: { fg: colors.amberFg, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
  primary: { fg: colors.primary, bg: colors.primarySoft },
};

/** ‏גלולת סטטוס — אותה משפחת צבעים כמו `.mv-chip-*` ב-web: 14/700, פינות 99. */
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: string }) {
  const { fg, bg } = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]} weight={700}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  text: { fontSize: type.caption, lineHeight: 18 },
});
