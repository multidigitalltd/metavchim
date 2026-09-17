import { StyleSheet, View } from "react-native";
import { colors, font, radius, space } from "@/theme";
import { Text } from "./Text";

export type Tone = "neutral" | "success" | "amber" | "danger" | "primary";

const TONES: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.chipNeutralFg, bg: colors.chipNeutralBg },
  success: { fg: colors.success, bg: colors.successSoft },
  amber: { fg: colors.amberFg, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
  primary: { fg: colors.primary, bg: colors.primarySoft },
};

/** ‏גלולת סטטוס — אותה משפחת צבעים כמו ב-web. */
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: string }) {
  const { fg, bg } = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    alignSelf: "flex-start",
  },
  text: { fontSize: font.xs, fontWeight: "600" },
});
