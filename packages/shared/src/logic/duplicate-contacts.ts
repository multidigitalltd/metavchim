/**
 * איתור ומיזוג של כרטיסים כפולים.
 *
 * למה זה קורה בכלל: אותו אדם נכנס פעם אחת מטופס האתר עם הנייד, פעם
 * שנייה כשהמתווך הקליד אותו ידנית עם טלפון הבית, ופעם שלישית מייבוא
 * אקסל ישן. ה-`phone_hash` מונע כפילות על *אותו* מספר, אבל אדם עם
 * שני מספרים מקבל שני כרטיסים — ומאותו רגע חצי מההיסטוריה שלו יושבת
 * בכרטיס אחד וחצי בשני.
 *
 * למה השם ולא הטלפון הוא סימן הזיהוי: שמות וטלפונים מוצפנים במסד,
 * ולכן אי אפשר להשוות אותם בשאילתה. חתימת שם מנורמל (HMAC) מאפשרת
 * למצוא התאמה מדויקת בלי לפענח דבר — פחות חכם מהשוואה מטושטשת,
 * אבל עובד על מאגר שלם בשאילתה אחת ובלי לחשוף PII.
 */

/**
 * נרמול שם לצורך חתימה בלבד.
 *
 * מטפל בדיוק במה שמפריד בפועל בין שתי הקלדות של אותו אדם: רווחים
 * כפולים, רווח בקצה, ותווי ניקוד/גרש. **לא** מסיר תארים ולא מנחש —
 * "דוד כהן" ו"ד. כהן" יישארו שונים, וזה מכוון: מיזוג שגוי של שני
 * אנשים הוא נזק שקשה לתקן, והחמצה היא רק אי-נוחות.
 */
export function normalizeNameForMatch(name: string): string {
  return name
    .trim()
    .replace(/["'`׳״]/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export interface DuplicateCandidate {
  contactId: string;
  name: string;
  phone: string;
  /** כמה ישויות תלויות בו — קונים, לידים, נכסים, שיחות, הודעות. */
  activity: number;
  createdAt: Date;
}

/**
 * מי שורד במיזוג.
 *
 * הכרטיס עם יותר פעילות שורד, כי הזזת מעט היסטוריה בטוחה מהזזת הרבה.
 * בתיקו — הוותיק שורד: הוא זה שהמתווך מכיר, שמופיע בקישורים ישנים,
 * ושהמזהה שלו כבר נשלח החוצה בהצעות. ההכרעה כאן ולא בשאילתה כדי
 * שתהיה בדוקה — בחירת שורד שגויה מוחקת את הכרטיס הפעיל.
 */
export function pickSurvivor(candidates: readonly DuplicateCandidate[]): DuplicateCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => {
    if (current.activity !== best.activity) return current.activity > best.activity ? current : best;
    return current.createdAt < best.createdAt ? current : best;
  });
}

export interface DuplicateGroup {
  /** חתימת השם המשותפת — לא מוצגת למשתמש, משמשת כמפתח יציב. */
  key: string;
  survivor: DuplicateCandidate;
  duplicates: DuplicateCandidate[];
}

/**
 * קיבוץ מועמדים לקבוצות מיזוג. קבוצה עם פחות משני חברים אינה כפילות
 * ואינה מוצגת — הדשבורד לא אמור להציע פעולה שאין בה טעם.
 */
export function groupDuplicates(
  candidates: readonly (DuplicateCandidate & { nameKey: string })[],
): DuplicateGroup[] {
  const byKey = new Map<string, (DuplicateCandidate & { nameKey: string })[]>();
  for (const candidate of candidates) {
    const list = byKey.get(candidate.nameKey) ?? [];
    list.push(candidate);
    byKey.set(candidate.nameKey, list);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const survivor = pickSurvivor(members);
    if (!survivor) continue;
    groups.push({
      key,
      survivor,
      duplicates: members.filter((m) => m.contactId !== survivor.contactId),
    });
  }
  // הקבוצות הגדולות ראשונות — שם הבלגן הכי גדול, ושם ההחזר הכי גבוה
  return groups.sort((a, b) => b.duplicates.length - a.duplicates.length);
}
