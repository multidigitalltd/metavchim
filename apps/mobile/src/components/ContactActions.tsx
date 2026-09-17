import { StyleSheet, View } from "react-native";
import { space } from "@/theme";
import { callPhone, openWhatsapp } from "@/lib/contact-actions";
import { Button } from "./Button";

/** ‏שני הכפתורים שכל כרטיס לקוח מתחיל בהם: חיוג ווואטסאפ. */
export function ContactActions({ phone, name }: { phone: string; name: string }) {
  return (
    <View style={styles.row}>
      <Button
        title="חיוג"
        kind="primary"
        style={styles.grow}
        onPress={() => void callPhone(phone)}
        accessibilityHint={`מחייג אל ${name}`}
      />
      <Button
        title="וואטסאפ"
        kind="secondary"
        style={styles.grow}
        onPress={() => void openWhatsapp(phone, `שלום ${name}, `)}
        accessibilityHint={`פותח שיחת וואטסאפ עם ${name}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  grow: { flex: 1 },
});
