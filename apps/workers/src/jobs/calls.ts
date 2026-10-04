import { ulid } from "ulid";
import {
  diarizeTimeoutMs,
  formatDiarizedTranscript,
  isGeneratedCallSummary,
  STT_CALL_HINT,
  buildCallIntelPrompt,
  CALL_INTEL_SCHEMA,
  formatRoleTranscript,
  mergeCallIntel,
  parseCallIntel,
  type CallIntel,
  type CallIntelContext,
  followUpFromCall,
  summarizeCall,
  type SpeakerTurn,
  type TranscriptSegment,
} from "@metavchim/shared";
import { prisma, withTenant } from "../runtime.js";
import { storageGet } from "../storage.js";
import { tenantHasFeature } from "../tenant-settings.js";
import { decryptSetting } from "../whatsapp/config.js";

/* ==================== תמלול וסיכום שיחות ==================== */

/**
 * סורק השיחות שממתינות לתמלול (docs/09 שלב 2).
 *
 * אותה תבנית של סורק הפוש ומאותה סיבה: העלאת ההקלטה רק מסמנת
 * `pending`, והעבודה הכבדה קורית כאן. תמלול של שיחה בת עשר דקות
 * אורך דקות על CPU — בקשת HTTP שממתינה לו נופלת על timeout
 * ומשאירה את המתווך בלי מושג מה קרה.
 *
 * אחת בכל סבב, לא בקבוצה: שירות התמלול מוגבל במקבילות (STT_CONCURRENCY),
 * ושליחת חמש הקלטות במקביל רק תייצר 429 ותאט את כולן.
 */
/** תקרת שדה התוכן של ציר הזמן; הטקסט המלא נשאר על כרטיס השיחה. */
const INTERACTION_CONTENT_LIMIT = 4000;

const CALL_TRANSCRIBE_TIMEOUT_MS = Number(
  process.env["STT_TIMEOUT_MS"] ?? 180_000,
);

/**
 * מבקש את תורי הדיבור מהשירות האופציונלי של זיהוי הדוברים.
 *
 * חלון הזמן נגזר מאורך ההקלטה ולא מקבוע: קבוע קצר היה מפיל *כל*
 * שיחה ארוכה אחרי שהשרת כבר עשה את העבודה, וקבוע ארוך היה משאיר
 * כשל אמיתי תוקע את התור (המקבילות היא 1). ראו diarizeTimeoutMs.
 *
 * מחזיר מערך ריק בכל כשל — וזו החלטה מכוונת: שיחה מתומללת בלי
 * תוויות דובר עדיפה בהרבה על שיחה שנופלת ל-failed בגלל שירות
 * שהוא ממילא תוספת. הכשל נרשם ללוג ולא מגיע למתווך.
 */
async function fetchSpeakerTurns(
  audio: Uint8Array,
  audioSeconds: number,
): Promise<SpeakerTurn[]> {
  const diarizeUrl = process.env["DIARIZE_URL"];
  const sttSecret = process.env["STT_SECRET"];
  if (!diarizeUrl || !sttSecret) return [];

  try {
    const form = new FormData();
    form.append("file", new Blob([audio]), "call.webm");
    const res = await fetch(`${diarizeUrl}/diarize`, {
      method: "POST",
      headers: { "x-stt-secret": sttSecret },
      body: form,
      signal: AbortSignal.timeout(diarizeTimeoutMs(audioSeconds)),
    });
    if (!res.ok) throw new Error(`diarize ${res.status}`);
    const body = (await res.json()) as { turns?: SpeakerTurn[] };
    return body.turns ?? [];
  } catch (error) {
    console.error(`[call-transcribe] diarization skipped: ${String(error)}`);
    return [];
  }
}

/* ==================== הבנת השיחה (Gemini) ==================== */

/** ברירת המחדל תואמת ל-`DEFAULT_GEMINI_MODEL` ב-API. */
const CALL_INTEL_MODEL_DEFAULT = "gemini-3.6-flash";
const CALL_INTEL_TIMEOUT_MS = Number(process.env["CALL_INTEL_TIMEOUT_MS"] ?? 45_000);
/*
 * תמלול של שיחה ארוכה חוצה בקלות את חלון ברירת המחדל. התקרה כאן
 * נדיבה כי הפלט כולל את התורות עצמן — כלומר בערך באורך הקלט.
 */
const CALL_INTEL_MAX_TOKENS = 8_192;
/** תמלול ארוך מזה נחתך: שיחה בת שעה אינה נכנסת לחלון, ובלי חיתוך הקריאה נכשלת כולה. */
const CALL_INTEL_TRANSCRIPT_MAX = 60_000;

let geminiCache: { key: string | null; model: string; until: number } | null = null;

/**
 * המפתח והמודל — מהגדרות הפלטפורמה, עם משתני הסביבה כ-Fallback.
 *
 * אותה תבנית של `whatsappConfig` ומאותה סיבה: ההגדרה נערכת במסך
 * הפלטפורמה ולא בקובץ סביבה, וה-Worker חייב לראות את אותו ערך.
 */
async function geminiConfig(): Promise<{ key: string; model: string } | null> {
  const now = Date.now();
  if (geminiCache && now < geminiCache.until) {
    return geminiCache.key ? { key: geminiCache.key, model: geminiCache.model } : null;
  }
  const rows = await prisma.platformSetting.findMany({
    where: { key: { in: ["geminiApiKey", "geminiModel"] } },
    select: { key: true, valueEncrypted: true },
  });
  const stored = new Map(rows.map((row) => [row.key, decryptSetting(row.valueEncrypted)] as const));
  const key = stored.get("geminiApiKey") ?? process.env["GEMINI_API_KEY"] ?? null;
  const model =
    stored.get("geminiModel") ?? process.env["GEMINI_MODEL"] ?? CALL_INTEL_MODEL_DEFAULT;
  geminiCache = { key, model, until: now + 60_000 };
  return key ? { key, model } : null;
}

/**
 * ‎**מה שהמודל מוסיף לשיחה — ו-`null` בכל כשל.**
 *
 * ‎`null` אינו מקרה קצה אלא מסלול צפוי: מפתח שלא הוגדר, מכסה
 * שנגמרה, פסק זמן, או תשובה שנפסלה בבדיקת המספרים. הקורא ממזג עם
 * `summarizeCall` וממשיך — שיחה לעולם אינה נתקעת בגלל המודל.
 */
async function callIntel(
  transcript: string,
  context: CallIntelContext,
): Promise<CallIntel | null> {
  const config = await geminiConfig();
  if (config === null || transcript.trim() === "") return null;

  const source = transcript.slice(0, CALL_INTEL_TRANSCRIPT_MAX);
  const prompt = buildCallIntelPrompt(source, context);

  /** קריאה אחת. מחזירה את הטקסט, או את קוד ה-HTTP כדי שהקורא יחליט. */
  const once = async (
    model: string,
    withSchema: boolean,
  ): Promise<{ text: string } | { status: number }> => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            ...(withSchema ? { responseSchema: CALL_INTEL_SCHEMA } : {}),
            // חילוץ, לא כתיבה — דטרמיניזם עדיף על יצירתיות
            temperature: 0,
            maxOutputTokens: CALL_INTEL_MAX_TOKENS,
          },
        }),
        signal: AbortSignal.timeout(CALL_INTEL_TIMEOUT_MS),
      },
    );
    if (!res.ok) return { status: res.status };
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return { text: body.candidates?.[0]?.content?.parts?.[0]?.text ?? "" };
  };

  try {
    /*
     * ‎**שני הניסיונות שה-API כבר למד לעשות, ומאותן סיבות.**
     *
     * ‎`GeminiService` מטפל בשני מצבים שקורים בייצור ואינם תקלה
     * אצלנו: מודל שהוצא משימוש מחזיר 404, ומודל שאינו תומך
     * ב-`responseSchema` מחזיר 400. בלי הניסיונות האלה שתי התצורות
     * האלה משביתות את הבנת השיחה **בשקט** — כל שיחה נופלת לחילוץ
     * הדטרמיניסטי ואיש אינו יודע למה (ביקורת Codex).
     *
     * הניסיון השני נעשה פעם אחת לכל שיחה ולא נזכר בין שיחות. זה
     * המחיר של אי-החזקת מצב ב-Worker שרץ בסבבים, והוא זול: קריאה
     * אחת נוספת על שיחה שממילא בילתה דקות בתמלול.
     */
    let out = await once(config.model, true);

    if ("status" in out && out.status === 400) {
      console.error(`[call-transcribe] intel: המודל ${config.model} דחה את הסכמה — ניסיון בלעדיה`);
      out = await once(config.model, false);
    } else if ("status" in out && out.status === 404 && config.model !== CALL_INTEL_MODEL_DEFAULT) {
      console.error(`[call-transcribe] intel: המודל ${config.model} אינו קיים — ניסיון בברירת המחדל`);
      out = await once(CALL_INTEL_MODEL_DEFAULT, true);
    }

    if ("status" in out) throw new Error(`gemini ${out.status}`);
    if (out.text.trim() === "") return null;
    /*
     * הפענוח מקבל את התמלול **המלא** ולא את החתוך: הוא מקור האמת
     * לבדיקת המספרים, וחיתוך שלו היה פוסל מספר אמיתי שנאמר בסוף
     * שיחה ארוכה.
     */
    return parseCallIntel(JSON.parse(out.text), transcript);
  } catch (error) {
    console.error(`[call-transcribe] intel skipped: ${String(error)}`);
    return null;
  }
}

export async function transcribeOneCall(): Promise<void> {
  const sttUrl = process.env["STT_URL"];
  const sttSecret = process.env["STT_SECRET"];
  if (!sttUrl || !sttSecret) return;

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    // המסלול נבדק לפני התפיסה: תור קיים אינו עוקף ביטול של הפיצ'ר
    if (!(await tenantHasFeature(tenant.id, "transcription"))) continue;
    const pending = await withTenant(tenant.id, async (tx) => {
      const row = await tx.call.findFirst({
        where: { tenantId: tenant.id, transcriptionStatus: "pending" },
        orderBy: { occurredAt: "asc" },
        select: {
          id: true,
          recordingKey: true,
          leadId: true,
          contactId: true,
          // רמז לזיהוי מי הוא מי: בשיחה יוצאת המתווך הוא שפותח
          direction: true,
          // מי תיעד את השיחה — עליו תיפול משימת ההמשך
          createdBy: true,
          /*
           * ‎**מה שהמתווך כתב ביד — כדי לא לדרוס אותו.**
           *
           * ההערה בכתיבה למטה הבטיחה זאת מזמן, אבל השדה לא נקרא
           * כאן ולכן אי אפשר היה לקיים אותה: מי שתיעד שיחה ידנית,
           * כתב סיכום, ואז העלה הקלטה — היה מאבד את מה שכתב
           * ברגע שהתמלול הסתיים, בלי אזהרה ובלי דרך לשחזר.
           */
          summary: true,
        },
      });
      if (!row?.recordingKey) return null;
      // תפיסה אטומית: שני סבבים חופפים לא ייקחו את אותה שיחה
      const claimed = await tx.call.updateMany({
        where: {
          id: row.id,
          tenantId: tenant.id,
          transcriptionStatus: "pending",
        },
        data: { transcriptionStatus: "running" },
      });
      return claimed.count === 1 ? row : null;
    });
    if (!pending?.recordingKey) continue;

    try {
      const audio = new Uint8Array(await storageGet(pending.recordingKey));
      const form = new FormData();
      form.append("file", new Blob([audio]), "call.webm");
      /*
       * ‎**רמז אוצר המילים — שתמלול השיחות לא שלח עד כה.**
       *
       * ‎`/transcribe` מקבל `prompt` ומעביר אותו ל-`initial_prompt`
       * של המודל, וההכתבה בדפדפן שלחה אותו מהיום הראשון. הקלטת
       * שיחה — אודיו טלפוני צר-פס, רועש, ועם שני דוברים — הגיעה
       * לכאן בלי שום הקשר, כלומר דווקא המסלול שהכי תלוי ברמז היה
       * היחיד בלעדיו. „ממ״ד” חזר „ממד” ו„בלעדיות” חזרה „בעלות”.
       */
      form.append("prompt", STT_CALL_HINT);
      const res = await fetch(`${sttUrl}/transcribe`, {
        method: "POST",
        headers: { "x-stt-secret": sttSecret },
        body: form,
        signal: AbortSignal.timeout(CALL_TRANSCRIBE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`stt ${res.status}`);
      const body = (await res.json()) as {
        text?: string;
        segments?: TranscriptSegment[];
        durationSeconds?: number;
      };
      /*
       * זיהוי הדוברים רץ *אחרי* התמלול ולא במקביל לו — שני המודלים
       * מתחרים על אותן ליבות, והרצה במקביל רק מאריכה את שניהם.
       */
      const segments = body.segments ?? [];
      // אורך ההקלטה מגיע מהתמלול עצמו; כשהוא חסר נגזר מהמקטע האחרון
      const audioSeconds =
        body.durationSeconds ?? segments[segments.length - 1]?.end ?? 0;
      const turns =
        segments.length > 0 ? await fetchSpeakerTurns(audio, audioSeconds) : [];
      const diarized = formatDiarizedTranscript(segments, turns);
      // נפילה חזרה ל-text כשהשירות הישן עדיין לא מחזיר segments
      const diarizedText = (diarized.text || body.text || "").trim();
      /*
       * ‎**הטקסט הנקי הוא מה שנשלח להבנה, לא הטקסט המתויג.**
       *
       * גם החילוץ הדטרמיניסטי וגם המודל קוראים את מה שנאמר, בלי
       * ‎"[01:15] דובר 2:" באמצע. ביטויי המפתח של הראשון נשברים על
       * התוויות, והשני היה מקבל שני סימוני דוברים סותרים.
       */
      const plain = (body.text ?? "").trim() || diarizedText;
      const parsedCall = summarizeCall(plain);

      /*
       * ‎**שם הלקוח אינו נמסר למודל, אף שהוא היה עוזר.**
       *
       * ‎„היי רות” בפי אחד הדוברים מכריע מיד מי המתווך. אבל השם
       * יושב ב-`nameEncrypted` — הוא מוצפן במנוחה בכוונה, ופענוח
       * שלו כדי לשלוח אותו לספק חיצוני הופך החלטת פרטיות מפורשת
       * על פיה בשביל רמז. כיוון השיחה נמסר במקומו, והוא חינם.
       */

      /*
       * ‎**ההבנה רצה אחרי החילוץ, לא במקומו.**
       *
       * ‎`summarizeCall` הוא רשת הביטחון: הוא אינו נשען על רשת, אינו
       * עולה כסף ואינו ממציא. המודל מוסיף מעליו את מה שדורש הבנה —
       * מי דיבר, מה הצד, ומה באמת סוכם — וכשהוא אינו מוגדר או נכשל,
       * השיחה מקבלת בדיוק את מה שקיבלה עד היום.
       */
      const intel = mergeCallIntel(
        await callIntel(plain, {
          direction: pending.direction === "outbound" ? "outbound" : "inbound",
        }),
        parsedCall,
      );
      /*
       * תורות מתויגות בתפקיד גוברות על „דובר 1/2”: הן אומרות מי
       * מהשניים המתווך, וזו כל השאלה. כשהמודל לא החזיר תורות —
       * נשאר מה שהיה.
       */
      const transcript =
        intel.turns.length > 0 ? formatRoleTranscript(intel.turns) : diarizedText;
      const summary = intel.summary;
      const highlights = intel.highlights;
      /*
       * ‎**הסיכום שהמתווך הקליד גובר, וגם נשאר זה שממנו נגזרת
       * משימת ההמשך.** אחרת המשימה הייתה נבנית מטקסט אחד והמסך
       * מציג טקסט אחר, ומי שקורא את שניהם אינו יכול ליישב ביניהם.
       *
       * ‎**אבל „קיים” אינו „נכתב ביד”** — וזה מה שהיה שבור. בשיחה
       * שלא נענתה `describeCall` כותב „שיחה נכנסת שלא נענתה” ברגע
       * שהוובהוק נקלט, בלי שאיש נגע. מי שהעלה אחר כך הקלטה לאותה
       * שיחה קיבל תמלול, סיכום אמיתי — **ואז הסיכום נזרק**, כי
       * השדה „כבר תפוס”. הכרטיס נשאר „שיחה שלא נענתה” לנצח, וזה
       * נראה כאילו התמלול לא עבד (דיווח מהשטח).
       *
       * ‎`isGeneratedCallSummary` יושב לצד `describeCall` ומזהה
       * בדיוק את מה שהוא מייצר, עם בדיקת הלוך-ושוב — כדי ששניהם
       * לא ייפרדו כשתתווסף צורה חמישית.
       */
      const manualSummary = isGeneratedCallSummary(pending.summary) ? "" : pending.summary!;
      const followUp = followUpFromCall(
        {
          ...parsedCall,
          summary: manualSummary !== "" ? manualSummary : summary,
          highlights,
          suggestedOutcome: intel.suggestedOutcome,
        },
        new Date(),
      );
      /** המשימה שנוצרה, אם נוצרה — קובעת את נוסח ההתראה היחידה. */
      let followUpNotice:
        | {
            reason: string;
            entity: { entityType: "lead" | "buyer"; entityId: string };
          }
        | undefined;

      await withTenant(tenant.id, async (tx) => {
        await tx.call.updateMany({
          where: { id: pending.id, tenantId: tenant.id },
          data: {
            transcript,
            // הסיכום נכתב רק כשלא נרשם אחד ידנית — מה שהמתווך
            // כתב בעצמו גובר תמיד על החילוץ האוטומטי
            ...(summary && !manualSummary ? { summary } : {}),
            /*
             * ‎**השדות שחולצו נשמרים, ולא רק השורה שנבנתה מהם.**
             *
             * ‎`summarizeCall` מחזיר גם `highlights` — תקציב, חדרים,
             * אזור ומועד חזרה — ועד כה הם נזרקו כאן, כך שמה שנשאר
             * היה מחרוזת אחת שאי אפשר לסנן לפיה או להזין ממנה שדה
             * בכרטיס. הם נכתבים תמיד, גם ריקים: „לא זוהה דבר” הוא
             * עובדה על השיחה, ולא היעדר עדכון.
             */
            highlights,
            transcriptionStatus: "done",
            transcribedAt: new Date(),
          },
        });
        /*
         * ציר הזמן של הלקוח מקבל את הסיכום **ואת התמלול המלא**.
         *
         * הסיכום לבדו לא מספיק: מתווך שחוזר לשיחה מלפני חודש רוצה
         * לדעת מה בדיוק נאמר, לא רק "הביע עניין · 4 חדרים". התמלול
         * נחתך לתקרת השדה כדי שלא ייחסם בכתיבה — הטקסט המלא נשאר
         * תמיד על כרטיס השיחה.
         */
        const timelineText = summary
          ? `סיכום שיחה: ${summary}${transcript ? `\n\n${transcript}` : ""}`
          : transcript;
        /*
         * הכרטיס שהשיחה שייכת אליו. שיחה שאינה קשורה לליד אך כן
         * לאיש קשר מוצגת בכרטיס הקונה שלו, ושם ציר הזמן לפי buyerId.
         * החיפוש נעשה פעם אחת ומשמש גם את ציר הזמן וגם את משימת
         * ההמשך — קודם הוא ישב בתוך בלוק ציר הזמן, ומשימה לא הייתה
         * יכולה להיתלות על אותו כרטיס.
         */
        const buyerForCall =
          !pending.leadId && pending.contactId
            ? await tx.buyer.findFirst({
                where: {
                  tenantId: tenant.id,
                  contactId: pending.contactId,
                  deletedAt: null,
                },
                select: { id: true },
              })
            : null;
        if (timelineText) {
          const content = timelineText.slice(0, INTERACTION_CONTENT_LIMIT);
          if (pending.leadId) {
            await tx.interaction.create({
              data: {
                id: ulid(),
                tenantId: tenant.id,
                leadId: pending.leadId,
                kind: "system",
                content,
                createdBy: null,
              },
            });
          }
          if (buyerForCall) {
            await tx.interaction.create({
              data: {
                id: ulid(),
                tenantId: tenant.id,
                buyerId: buyerForCall.id,
                kind: "system",
                content,
                createdBy: null,
              },
            });
          }
        }

        /*
         * משימת ההמשך שהשיחה מחייבת.
         *
         * עד כה התמלול נכתב לציר הזמן ונגמר שם — ההבטחה "אחזור אליך
         * ביום ראשון" נשמרה כטקסט ואיש לא הזכיר אותה ביום ראשון.
         * הכללים (מתי כן ומתי בשום אופן לא) יושבים ב-`followUpFromCall`
         * ומכוסים בבדיקות; כאן רק הכתיבה.
         *
         * בתוך אותה טרנזקציה של הסיכום: משימה בלי הסיכום שהצדיק
         * אותה, או סיכום בלי המשימה שהובטחה בו, הם שני מצבים גרועים
         * יותר מלנסות שוב.
         */
        /*
         * המשימה נתלית על כרטיס שאפשר לפתוח — ליד או קונה. שיחה עם
         * איש קשר שאין לו כרטיס קונה אינה מייצרת משימה: משימה שאי
         * אפשר ללחוץ עליה כדי להגיע ללקוח היא תזכורת בלי כתובת.
         */
        const followUpEntity = pending.leadId
          ? ({ entityType: "lead", entityId: pending.leadId } as const)
          : buyerForCall
            ? ({ entityType: "buyer", entityId: buyerForCall.id } as const)
            : null;
        if (followUp && pending.createdBy && followUpEntity) {
          const entity = followUpEntity;
          /*
           * מפתח לפי השיחה ולא לפי הכרטיס: תמלול רץ פעם אחת לשיחה,
           * ולקוח שדיבר פעמיים ראוי לשתי משימות. הבדיקה מגנה מפני
           * ריצה חוזרת של אותה שיחה.
           */
          const sourceKey = `call-followup:${pending.id}`;
          const already = await tx.task.findFirst({
            where: { tenantId: tenant.id, sourceKey },
            select: { id: true },
          });
          const assigneeActive =
            (await tx.user.findFirst({
              where: {
                id: pending.createdBy,
                tenantId: tenant.id,
                isActive: true,
              },
              select: { id: true },
            })) !== null;
          if (!already && assigneeActive) {
            await tx.task.create({
              data: {
                id: ulid(),
                tenantId: tenant.id,
                assignedToUserId: pending.createdBy,
                title: followUp.title,
                notes: followUp.reason,
                priority: followUp.priority,
                dueAt: followUp.dueAt,
                ...entity,
                sourceKey,
              },
            });
            followUpNotice = { reason: followUp.reason, entity };
          }
        }

        /*
         * **התראה אחת לכל תמלול**, ולא אחת לתמלול ואחת למשימה.
         *
         * עד כה התראה נשלחה **רק** כשהתמלול הניב משימת המשך, ורק
         * כשהיו לה גם מתעד וגם כרטיס מקושר. כלומר רוב התמלולים
         * הסתיימו בלי שאיש ידע — ומסך השיחות אינו מרענן את עצמו,
         * אז הדרך היחידה לגלות הייתה לטעון אותו מחדש ולנחש.
         *
         * שתי התראות על אותה שיחה היו שני צלצולים על אירוע אחד;
         * לכן ההודעה אחת, והיא מספרת גם על המשימה כשנוצרה.
         */
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: tenant.id,
            /*
             * ‎`createdBy`‎ ריק בשיחה שהגיעה מהמרכזייה ולא תועדה
             * ביד. `null` פירושו התראה לכל המשרד — עדיף מהתראה
             * שאיש אינו מקבל.
             */
            userId: pending.createdBy ?? null,
            type: followUpNotice ? "call_follow_up" : "call_transcribed",
            title: followUpNotice
              ? "התמלול מוכן — ונוצרה משימת המשך"
              : "התמלול מוכן",
            // התקרה היא 500 בסכמה; חיתוך כאן ולא שגיאת כתיבה שם
            body: (followUpNotice?.reason ?? summary ?? "").slice(0, 500) || undefined,
            /*
             * כשנוצרה משימה ההתראה מצביעה על הכרטיס — שם מטפלים
             * בה. אחרת על השיחה עצמה, שהיא מה שההתראה מדברת עליו.
             */
            ...(followUpNotice?.entity ?? {
              entityType: "call",
              entityId: pending.id,
            }),
          },
        });
      });
    } catch (error) {
      console.error(`[call-transcribe] ${pending.id} failed: ${String(error)}`);
      await withTenant(tenant.id, async (tx) => {
        await tx.call.updateMany({
          where: { id: pending.id, tenantId: tenant.id },
          data: { transcriptionStatus: "failed" },
        });
        /*
         * גם כישלון הוא סיום, וגם עליו מודיעים.
         *
         * תמלול שנכשל בשקט נראה בדיוק כמו תמלול שעוד רץ: הסטטוס
         * במסך משתנה מ"מתמלל" ל"נכשל", ואיש אינו מסתכל. מי
         * שהמתין להקלטה של שיחה ממתין לשווא.
         */
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: tenant.id,
            userId: pending.createdBy ?? null,
            type: "call_transcribe_failed",
            title: "תמלול השיחה נכשל",
            body: "אפשר לנסות שוב מכרטיס השיחה, או להאזין להקלטה.",
            entityType: "call",
            entityId: pending.id,
          },
        });
      });
    }
    // שיחה אחת לסבב — הסבב הבא בעוד דקה ייקח את הבאה בתור
    return;
  }
}
