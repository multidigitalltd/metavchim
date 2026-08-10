import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
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
  app.useBodyParser("json", { limit: "2mb" });
  app.useBodyParser("urlencoded", { limit: "2mb", extended: true });

  app.use(helmet());
  app.use(cookieParser());

  // req.ip מאחורי LB: סופרים רק שכבות Proxy מוצהרות — 0 בפיתוח מונע
  // זיוף X-Forwarded-For שעוקף את מגבלת ההתחברות (docs/04 §6).
  app.getHttpAdapter().getInstance().set("trust proxy", env.TRUST_PROXY_HOPS);

  // CORS נעול ל-Origin המוצהר בלבד — לא wildcard, לא רשימה דינמית.
  app.enableCors({
    origin: [env.WEB_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });

  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
}

void bootstrap();
