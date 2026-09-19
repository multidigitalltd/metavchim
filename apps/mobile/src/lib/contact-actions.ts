import { Alert, Linking } from "react-native";
import { canReceiveWhatsapp, whatsappLink } from "@metavchim/shared";

/**
 * ‏וואטסאפ ללקוח — יוצא מהאפליקציה אל וואטסאפ של המכשיר: המערכת אינה
 * ‏שולחת דבר מעצמה, כמו ב-web (docs/README, עיקרון 8). חיוג וואטסאפ
 * ‏מתוך הכרטיסים הם של ה-web המוטמע.
 */
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
