import { StyleSheet, View } from "react-native";
import { radius, space, type, type Palette } from "@/theme";
import { useColors } from "@/lib/theme";
import { Text } from "./Text";

export type Tone = "neutral" | "success" | "amber" | "danger" | "primary";

function tones(c: Palette): Record<Tone, { fg: string; bg: string }> {
  return {
    neutral: { fg: c.chipNeutralFg, bg: c.chipNeutralBg },
    success: { fg: c.success, bg: c.successSoft },
    amber: { fg: c.amberFg, bg: c.warningBg },
    danger: { fg: c.danger, bg: c.dangerSoft },
    primary: { fg: c.primary, bg: c.primarySoft },
  };
}

/** ‏גלולת סטטוס — אותה משפחת צבעים כמו `.mv-chip-*` ב-web: 14/700, פינות 99. */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: string;
}) {
  const { fg, bg } = tones(useColors())[tone];
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
