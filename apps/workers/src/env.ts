import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ‏טעינת `.env` בפיתוח. **הייבוא הראשון של `main.ts`:** מודולים אחרים
 * ‏קוראים משתני סביבה כבר בטעינה (תורים, S3, ספים), ולכן הקובץ חייב
 * ‏לרוץ לפניהם. בייצור הסביבה מגיעה מ-compose ואין קובץ לטעון.
 */
for (const candidate of [
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), ".env"),
]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* קובץ פגום — נסמוך על משתני הסביבה הקיימים */
    }
  }
}
