import { StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { family } from "@/lib/fonts";
import { colors } from "@/theme";
import { Text } from "./Text";

/**
 * ‏סימן המותג — אותם נתיבים כמו `LogoMark` ב-`apps/web/src/app/icons.tsx`
 * ‏(`viewBox 0 0 48 48`): צלע לבנה, צלע בצבע הפעולה, וריבוע במרכז.
 */
export function LogoMark({ size = 30, color = "#ffffff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" accessibilityElementsHidden>
      <Path d="M28.5 6.5h7a6 6 0 0 1 6 6v23a6 6 0 0 1-6 6h-7" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <Path d="M19.5 6.5h-7a6 6 0 0 0-6 6v23a6 6 0 0 0 6 6h7" stroke={colors.action} strokeWidth={5} strokeLinecap="round" />
      <Rect x={19.4} y={19.4} width={9.2} height={9.2} rx={2.4} fill={colors.action} />
    </Svg>
  );
}

/** ‏הלוגו המלא — הסימן ו„מתווכים.” עם הנקודה בצבע הפעולה, כמו `.mv-logo`. */
export function Logo({ size = 30, color = "#ffffff", wordmark = 27 }: { size?: number; color?: string; wordmark?: number }) {
  return (
    <View style={styles.row}>
      <LogoMark size={size} color={color} />
      <Text style={[styles.word, { color, fontSize: wordmark, fontFamily: family(900) }]}>
        מתווכים
        <Text style={[styles.word, { color: colors.action, fontSize: wordmark, fontFamily: family(900) }]}>.</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  word: { letterSpacing: -0.3, lineHeight: undefined },
});
