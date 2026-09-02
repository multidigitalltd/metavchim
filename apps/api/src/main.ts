import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { json } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === "production" ? ["error", "warn", "log"] : ["debug", "log", "warn", "error"],
    rawBody: true, // נדרש לאימות חתימות Webhook (WhatsApp)
    /*
     * רישום ידני של מפרקי הגוף, כי ברירת המחדל (100KB) קטנה מדי
     * לייבוא: אצווה של 500 לקוחות עם הערות ארוכות שוקלת ~400KB,
     * והמשתמש קיבל "request entity too large" על קובץ לגיטימי
     * לגמרי. חשוב לכבות את הרישום האוטומטי — אחרת המפרק של 100KB
     * רץ ראשון וזורק 413 לפני שהמפרק המורחב מקבל את הבקשה בכלל.
     */
    bodyParser: false,
  });
  /*
   * ‏Webhook הדואר הנכנס מקבל מפרק משלו, רחב יותר, **לפני** הגלובלי:
   * תשובת לקוח עם קבצים מצורפים מגיעה מהספק כ-JSON שיכול לשקול
   * עשרות MB (התקרה אצל Postmark: ‎35MB), והמפרק של 2MB היה זורק
   * 413 לפני שהבקר רואה את הבקשה — והספק היה מנסה שוב לנצח
   * (ביקורת Codex). הקבצים עצמם אינם נשמרים; המפרק רק מכניס את
   * הבקשה פנימה כדי שהטקסט ייקלט. הסיכון תחום: נתיב אחד, והמפרק
   * של Express דוחה מעל הגבול תוך כדי קריאה, בלי לצבור מעבר לו.
   */
  /*
   * שני נתיבי הקליטה, ולא אחד. לתמיכה חסרה התקרה הזאת, ולכן פנייה
   * עם צילום מסך גדול נדחתה על גבול הגוף המוגדר כברירת מחדל —
   * הספק קיבל שגיאה וניסה שוב, והצילום לא נשמר מעולם.
   */
  app.use("/api/v1/public/email/inbound", json({ limit: "40mb" }));
  app.use("/api/v1/public/support/inbound", json({ limit: "40mb" }));
  app.useBodyParser("json", { limit: "2mb" });
  app.useBodyParser("urlencoded", { limit: "2mb", extended: true });

  app.use(helmet());
  app.use(cookieParser());

  // req.ip מאחורי LB: סופרים רק שכבות Proxy מוצהרות — 0 בפיתוח מונע
  // זיוף X-Forwarded-For שעוקף את מגבלת ההתחברות (docs/04 §6).
  app.getHttpAdapter().getInstance().set("trust proxy", env.TRUST_PROXY_HOPS);

  /*
   * ‎**CORS נעול ל-Origin המוצהר בלבד** — לא wildcard, לא רשימה דינמית.
   *
   * ‏רשימת הפעלים חייבת לכסות את **כל** מה שהבקרים מצהירים עליו.
   * ‎`PUT` נעדר ממנה, ושלושה מסלולים כאלה כבר קיימים (הרשאות משתמש,
   * תבניות הסכם, ויעדי המנטור) — כלומר הדפדפן קיבל `ERR_FAILED` על
   * שמירה, בלי סטטוס ובלי הודעה, ובלי שהבקשה הגיעה לשרת בכלל.
   *
   * ‏זה **לא** נראה בייצור, ובדיוק זה מה שהופך אותו למלכודת: שם
   * ‎`NEXT_PUBLIC_API_URL` ריק, הדפדפן קורא ל-`/api/v1` על אותו מקור,
   * ו-CORS אינו רץ כלל. בפיתוח (‎:3000 מול ‎:3001) הוא כן — ולכן
   * הפיתוח שיקר לגבי הייצור לשני הכיוונים. שער
   * ‎`cors-methods.test.ts` גוזר עכשיו את הרשימה מהבקרים.
   */
  app.enableCors({
    origin: [env.WEB_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
}

void bootstrap();
