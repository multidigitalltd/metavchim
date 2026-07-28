import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, {
    logger: env.NODE_ENV === "production" ? ["error", "warn", "log"] : ["debug", "log", "warn", "error"],
    rawBody: true, // נדרש לאימות חתימות Webhook (WhatsApp)
  });

  app.use(helmet());
  app.use(cookieParser());

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
