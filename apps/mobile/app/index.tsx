import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Loading } from "@/components";

/** ‏נקודת הכניסה — מפנה לפי מצב ההתחברות; ה-Gate במעטפת עושה את השאר. */
export default function Index() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  return <Redirect href={user === null ? "/login" : "/today"} />;
}
