import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { apiPost, errorMessage } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Button, Field, Text } from "@/components";
import { space } from "@/theme";
import { makeStyles } from "@/lib/theme";

/**
 * ‏„שכחתי סיסמה” — אותו נתיב ואותה התנהגות כמו ב-web: התשובה זהה
 * ‏תמיד, בין אם הכתובת רשומה ובין אם לא (מניעת מיפוי משתמשים). הקישור
 * ‏מגיע במייל, נפתח בדפדפן של המכשיר וקובע סיסמה חדשה; אחר כך
 * ‏מתחברים כאן איתה.
 */
export default function ForgotPasswordScreen() {
  const styles = useStyles();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) {
      setError("יש להזין כתובת אימייל תקינה");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/auth/forgot-password", { email: address });
      setSent(true);
    } catch (err: unknown) {
      setError(errorMessage(err, "השליחה נכשלה — נסו שוב"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="איפוס סיסמה"
      subtitle="נשלח לך קישור לאיפוס הסיסמה במייל."
      points={[
        "הקישור תקף ל-30 דקות",
        "נשלח רק לכתובת שרשומה במערכת",
        "אף אחד אחר לא מקבל התראה",
      ]}
    >
      {sent ? (
        <View style={styles.stack}>
          <View style={styles.notice} accessibilityRole="alert">
            <Text>
              אם הכתובת רשומה במערכת — נשלח אליה קישור לאיפוס הסיסמה. הקישור תקף
              ל-30 דקות. בדקו גם בתיקיית הספאם.
            </Text>
          </View>
          <Button
            title="חזרה להתחברות"
            kind="ghost"
            onPress={() => router.replace("/login")}
          />
        </View>
      ) : (
        <View style={styles.stack}>
          <Field
            label="האימייל שלך"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            error={error}
          />
          <Button
            title="שלח קישור לאיפוס"
            onPress={() => void submit()}
            busy={busy}
          />
          <Button
            title="חזרה להתחברות"
            kind="text"
            onPress={() => router.back()}
          />
        </View>
      )}
    </AuthShell>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    stack: { gap: 14 },
    notice: {
      borderWidth: 1,
      borderColor: c.success,
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: space.md,
    },
  };
});
