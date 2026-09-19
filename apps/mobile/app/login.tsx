import { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { googleLoginErrorText } from "@metavchim/shared";
import {
  apiConfigured,
  API_OVERRIDE_ALLOWED,
  apiOrigin,
  isValidApiOrigin,
  setApiOrigin,
  BUILT_IN_API_ORIGIN,
} from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { apiGet, errorMessage } from "@/lib/api";
import { openGoogleSignIn } from "@/lib/google-login";
import { AuthShell } from "@/components/AuthShell";
import { Button, Card, Field, Text } from "@/components";
import { space } from "@/theme";
import { makeStyles } from "@/lib/theme";

/**
 * ‏מסך ההתחברות — כמו `/login` ב-web: לוח המותג, ומתחתיו אימייל
 * ‏וסיסמה, „שכחתי סיסמה”, „התחברות עם Google” כשהחיבור מוגדר בשרת,
 * ‏ושלב שני של קוד אימייל כשהשרת דורש. אותם נתיבי API, עם
 * ‏`client: "mobile"` (ראו `lib/auth` ו-`lib/google-login`).
 *
 * ‏כתובת השרת אינה מוצגת: היא צרובה בבנייה. „הגדרות מתקדמות” — לבדיקות
 * ‏מול שרת אחר — נפתחות בלחיצה ארוכה על הלוגו, ואינן חלק מהמסך.
 */
export default function LoginScreen() {
  const styles = useStyles();
  const { login, verifyOtp, loginWithGoogle } = useAuth();
  const router = useRouter();
  const { googleError } = useLocalSearchParams<{ googleError?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    googleError === undefined ? null : googleLoginErrorText(googleError),
  );
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  // ‏„הגדרות מתקדמות” — רק בבניות בדיקה; בחנות אין דרך להחליף שרת
  const [advanced, setAdvanced] = useState(
    API_OVERRIDE_ALLOWED && !apiConfigured(),
  );
  const [server, setServer] = useState(apiOrigin());
  const [serverNote, setServerNote] = useState<string | null>(null);

  // הכפתור מוצג רק כשהחיבור מוגדר בפועל — אחרת הוא היה מוביל לשגיאה
  useEffect(() => {
    let cancelled = false;
    apiGet<{ google: boolean }>("/auth/providers")
      .then((res) => {
        if (!cancelled) setGoogleEnabled(res.google === true);
      })
      .catch(() => {
        if (!cancelled) setGoogleEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveServer() {
    const value = server.trim();
    if (value !== "" && !isValidApiOrigin(value)) {
      setServerNote("כתובת בצורה http(s)://host[:port] — בלי נתיב");
      return;
    }
    const applied = await setApiOrigin(value);
    setServer(applied);
    setServerNote(applied === "" ? "חזרה לכתובת הצרובה" : "נשמר");
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

  async function withGoogle() {
    setError(null);
    setGoogleBusy(true);
    try {
      const outcome = await openGoogleSignIn();
      if (outcome.kind === "code") await loginWithGoogle(outcome.code);
      else if (outcome.kind === "error")
        setError(googleLoginErrorText(outcome.error));
    } catch (err: unknown) {
      setError(errorMessage(err, googleLoginErrorText("failed")));
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <AuthShell
      title={otpToken === null ? "התחברות" : "קוד אימות"}
      subtitle={
        otpToken === null
          ? "נכנסים עם החשבון שמנהל המשרד פתח לך."
          : `שלחנו קוד בן 6 ספרות לכתובת ${email.trim()}.`
      }
      onBrandLongPress={
        API_OVERRIDE_ALLOWED ? () => setAdvanced((v) => !v) : undefined
      }
    >
      {otpToken === null ? (
        <View style={styles.stack}>
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
          <Button
            title="התחברות"
            onPress={() => void submit()}
            busy={busy}
            disabled={googleBusy}
          />
          {googleEnabled ? (
            <Button
              title="התחברות עם Google"
              kind="ghost"
              onPress={() => void withGoogle()}
              busy={googleBusy}
              disabled={busy}
              accessibilityHint="נפתח דפדפן לבחירת חשבון Google"
            />
          ) : null}
          <Button
            title="שכחתי סיסמה"
            kind="text"
            onPress={() => router.push("/forgot-password")}
          />
        </View>
      ) : (
        <View style={styles.stack}>
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
            kind="text"
            onPress={() => {
              setOtpToken(null);
              setError(null);
            }}
          />
        </View>
      )}

      {advanced ? (
        <Card style={styles.advanced}>
          <Text variant="label">הגדרות מתקדמות</Text>
          <Text variant="small">
            השרת שהאפליקציה מדברת איתו — לבדיקות בלבד. ריק = הכתובת הצרובה
            בבנייה
            {BUILT_IN_API_ORIGIN ? " (קיימת)" : " (חסרה)"}.
          </Text>
          <Field
            label="כתובת שרת"
            value={server}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://…"
            error={serverNote}
          />
          <Button
            title="שמירה"
            kind="ghost"
            small
            onPress={() => void saveServer()}
          />
        </Card>
      ) : null}
    </AuthShell>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    stack: { gap: 14 },
    advanced: { marginTop: space.xl, borderColor: c.warning },
  };
});
