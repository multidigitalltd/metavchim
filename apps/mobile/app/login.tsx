import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { apiConfigured, apiOrigin, isValidApiOrigin, setApiOrigin, BUILT_IN_API_ORIGIN } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { Button, Card, Field, Screen, Text } from "@/components";
import { colors, space } from "@/theme";

/**
 * ‏מסך ההתחברות — אימייל וסיסמה, ושלב שני של קוד אימייל כשהשרת דורש.
 * ‏אותם שני נתיבי API כמו ב-web, עם `client: "mobile"` (ראו `lib/auth`).
 */
export default function LoginScreen() {
  const { login, verifyOtp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [server, setServer] = useState(apiOrigin());
  const [serverNote, setServerNote] = useState<string | null>(null);

  async function saveServer() {
    const value = server.trim();
    if (value !== "" && !isValidApiOrigin(value)) {
      setServerNote("כתובת בצורה http(s)://host[:port] — בלי נתיב");
      return;
    }
    const applied = await setApiOrigin(value);
    setServer(applied);
    setServerNote(applied === "" ? "אין כתובת שרת" : `השרת: ${applied}`);
  }

  async function submit() {
    setError(null);
    if (!email.trim() || password.length < 8) {
      setError("יש להזין אימייל וסיסמה (8 תווים לפחות)");
      return;
    }
    setBusy(true);
    try {
      const outcome = await login(email.trim().toLowerCase(), password);
      if (outcome.kind === "otp") {
        setOtpToken(outcome.otpToken);
        setCode("");
      }
    } catch (err: unknown) {
      setError(errorMessage(err, "שגיאה בהתחברות — נסו שוב"));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (otpToken === null) return;
    setError(null);
    if (!/^\d{6}$/u.test(code)) {
      setError("הקוד הוא 6 ספרות");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(otpToken, code);
    } catch (err: unknown) {
      setError(errorMessage(err, "האימות נכשל — נסו שוב"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.brand}>
          <Text variant="heading" style={styles.center}>
            מתווכים
          </Text>
          <Text variant="muted" style={styles.center}>
            המתווך סוגר עסקאות. המערכת מטפלת בכל השאר.
          </Text>
        </View>

        {!apiConfigured() ? (
          <Card style={styles.warn}>
            <Text style={styles.warnText}>
              כתובת השרת אינה מוגדרת — פתחו „הגדרות מתקדמות” וכתבו אותה, או הגדירו
              EXPO_PUBLIC_API_URL בבנייה.
            </Text>
          </Card>
        ) : null}

        <Card>
          {otpToken === null ? (
            <>
              <Field
                label="אימייל"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="next"
              />
              <Field
                label="סיסמה"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                error={error}
              />
              <Button title="התחברות" onPress={() => void submit()} busy={busy} />
            </>
          ) : (
            <>
              <Text>שלחנו קוד בן 6 ספרות לכתובת {email.trim()}.</Text>
              <Field
                label="קוד אימות"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                returnKeyType="go"
                onSubmitEditing={() => void verify()}
                error={error}
              />
              <Button title="אימות" onPress={() => void verify()} busy={busy} />
              <Button
                title="חזרה"
                kind="ghost"
                onPress={() => {
                  setOtpToken(null);
                  setError(null);
                }}
              />
            </>
          )}
        </Card>

        <Button
          title={advanced ? "סגירת הגדרות מתקדמות" : "הגדרות מתקדמות"}
          kind="ghost"
          onPress={() => setAdvanced((v) => !v)}
        />
        {advanced ? (
          <Card>
            <Text variant="muted">
              כתובת השרת שהאפליקציה מדברת איתו. ריק = הכתובת הצרובה בבנייה
              {BUILT_IN_API_ORIGIN ? ` (${BUILT_IN_API_ORIGIN})` : ""}.
            </Text>
            <Field
              label="כתובת שרת"
              value={server}
              onChangeText={setServer}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.10:3001"
              error={serverNote}
            />
            <Button title="שמירת הכתובת" kind="secondary" onPress={() => void saveServer()} />
          </Card>
        ) : (
          <Text variant="small" style={styles.center}>
            {apiConfigured() ? `שרת: ${apiOrigin()}` : ""}
          </Text>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { paddingVertical: space.xl, gap: space.xs },
  center: { textAlign: "center" },
  warn: { backgroundColor: colors.warningBg, borderColor: colors.warning, marginBottom: space.md },
  warnText: { color: colors.warning },
});
