import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * שומר מבני על docker-compose.prod.yml.
 *
 * הרקע: compose מפרש את כל הקובץ **לפני** שהוא מסנן שירותים לפי
 * פרופילים. לכן `${VAR:?הודעה}` על שירות שמאחורי פרופיל כבוי מפיל כל
 * פקודת compose בשרת — כולל `logs` ו-`ps` — על שירות שלא אמור לרוץ שם
 * בכלל. התסמין מטעה לחלוטין: משתמש שרץ מאחורי nginx קיים ראה כשל
 * שנראה כמו תקלת גיבוי, כשבפועל שום פקודה לא הצליחה לרוץ.
 *
 * זה קרה כאן פעמיים (STT_SECRET, ואז DOMAIN), ולכן הכלל נאכף ולא
 * מתועד בהערה בלבד. שירות ללא פרופיל מותר לו לדרוש משתנה: הוא רץ
 * תמיד, וכשל מוקדם עליו הוא בדיוק ההתנהגות הרצויה.
 *
 * הבדיקה יושבת כאן ולא בשורש כי זו החבילה שמריצה vitest ב-CI, לצד
 * שומרי המבנה האחרים (auth-coverage).
 */

const COMPOSE_PATH = resolve(__dirname, "../../../../docker-compose.prod.yml");

type Service = { name: string; line: number; profiled: boolean; required: string[] };

/**
 * פירוק רדוד ומכוון: מזהה כותרות שירות בהזחה של שני רווחים, ולכל
 * שירות אוסף אם יש לו `profiles:` ואילו משתנים הוא דורש ב-`:?`.
 * מספיק לכלל שנאכף כאן, ולא גורר תלות ב-parser של YAML.
 */
function parseServices(source: string): Service[] {
  const lines = source.split("\n");
  const services: Service[] = [];
  let inServices = false;
  let current: Service | null = null;

  for (const [index, line] of lines.entries()) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    // כל בלוק ברמה העליונה אחרי services (למשל volumes:) מסיים את המעבר
    if (inServices && /^[a-z]/i.test(line)) break;
    if (!inServices) continue;

    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = { name: header[1]!, line: index + 1, profiled: false, required: [] };
      services.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\s+profiles:/.test(line)) current.profiled = true;
    for (const match of line.matchAll(/\$\{([A-Za-z0-9_]+):\?/g)) {
      current.required.push(match[1]!);
    }
  }
  return services;
}

describe("docker-compose.prod.yml", () => {
  const services = parseServices(readFileSync(COMPOSE_PATH, "utf8"));

  it("מוצא את השירותים בקובץ", () => {
    expect(services.length).toBeGreaterThan(5);
    expect(services.map((s) => s.name)).toContain("caddy");
  });

  it("הבדיקה עצמה תופסת את התבנית האסורה", () => {
    // בלי האימות הזה, שגיאה בפירוק הייתה הופכת את הבדיקה לירוקה תמיד
    const sample = parseServices(
      ["services:", "  demo:", "    profiles: [\"x\"]", "    environment:", "      A: ${A:?חסר}"].join(
        "\n",
      ),
    );
    expect(sample[0]?.profiled).toBe(true);
    expect(sample[0]?.required).toEqual(["A"]);
  });

  it("שירות מאחורי פרופיל לא דורש משתנה סביבה — זה מפיל כל פקודת compose", () => {
    const offenders = services
      .filter((s) => s.profiled && s.required.length > 0)
      .map((s) => `${s.name} (שורה ${s.line}): ${s.required.join(", ")}`);
    expect(offenders).toEqual([]);
  });
});
