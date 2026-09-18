import { Alert, Linking } from "react-native";
import { canReceiveWhatsapp, whatsappLink } from "@metavchim/shared";

/**
 * ‏הפעולות שהמתווך עושה עם טלפון ביד: חיוג ווואטסאפ.
 *
 * ‏שתיהן יוצאות מהאפליקציה אל אפליקציית הטלפון / וואטסאפ של המכשיר —
 * ‏המערכת אינה שולחת דבר מעצמה, כמו ב-web (docs/README, עיקרון 8).
 */
export async function callPhone(phone: string): Promise<void> {
  const url = `tel:${phone.replace(/[^\d+]/gu, "")}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("אי אפשר לחייג מהמכשיר הזה");
  }
}

export async function openWhatsapp(phone: string, message = ""): Promise<void> {
  if (!canReceiveWhatsapp(phone)) {
    Alert.alert("המספר אינו נייד ישראלי", "וואטסאפ נשלח רק למספר נייד.");
    return;
  }
  try {
    await Linking.openURL(whatsappLink(phone, message));
  } catch {
    Alert.alert("וואטסאפ אינו מותקן במכשיר");
  }
}
