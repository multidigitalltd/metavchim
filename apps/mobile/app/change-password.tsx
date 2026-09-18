import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform } from "react-native";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, Screen, Text } from "@/components";

/** ‏אותו סף כמו בשרת (`ChangePasswordSchema`) וכמו במסך ה-web. */
const MIN_LENGTH = 10;

/**
 * ‏החלפת סיסמה זמנית — התחנה היחידה שפתוחה למי שנכנס עם סיסמה
 * ‏שמנהל המשרד הקליד. השומר ב-`_layout` מביא לכאן ואינו משחרר עד
 * ‏שהשרת מוריד את `mustChangePassword`.
 */
export default function ChangePasswordScreen() {
  const { changePassword, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (next.length < MIN_LENGTH) {
      setError(`הסיסמה החדשה חייבת להיות באורך ${MIN_LENGTH} תווים לפחות`);
      return;
    }
    if (next !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      Alert.alert("הסיסמה הוחלפה", "התחברו מחדש עם הסיסמה החדשה.");
    } catch (err: unknown) {
      setError(errorMessage(err, "החלפת הסיסמה נכשלה"));
      setBusy(false);
    }
  }

  return (
    <Screen title="החלפת סיסמה">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Card>
          <Text variant="title">נדרשת סיסמה חדשה</Text>
          <Text variant="muted">
            נכנסתם עם סיסמה זמנית. יש להחליף אותה לפני שממשיכים.
          </Text>
          <Field
            label="הסיסמה הנוכחית"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
          />
          <Field
            label={`סיסמה חדשה (${MIN_LENGTH} תווים לפחות)`}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <Field
            label="אימות הסיסמה החדשה"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            error={error}
          />
          <Button title="החלפת סיסמה" onPress={() => void submit()} busy={busy} />
          <Button title="התנתקות" kind="ghost" onPress={() => void logout()} />
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}
