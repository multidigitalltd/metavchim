/**
 * צילום המסך הנוכחי — בלי ספרייה חיצונית.
 *
 * הדרך המקובלת היא ספריות שמשרטטות מחדש את ה-DOM לתוך קנבס
 * (html2canvas ודומותיה). לא כאן, משתי סיבות: הן מוסיפות מאות
 * קילובייטים לכל טעינת עמוד עבור כפתור שרוב המשתמשים לא ילחצו
 * עליו, והן משרטטות **פרשנות** של הדף — צבעים מודרניים
 * (‏oklch של Tailwind 4‏), מפה על WebGL וגופנים שנטענו מאוחר יוצאים
 * שונה ממה שהמשתמש ראה. צילום שמראה משהו אחר מהתקלה גרוע מאין צילום.
 *
 * `getDisplayMedia` מחזיר את מה שהמסך באמת מראה, כולל המפה, ובלי
 * שורת קוד של ספרייה. המחיר הוא אישור של הדפדפן — וזה מחיר הוגן:
 * צילום של מסך CRM מכיל פרטי לקוחות, ומי ששולח אותו צריך לדעת זאת.
 */

/** האם הדפדפן יודע לצלם בכלל — במובייל לרוב לא, ואז מעלים קובץ. */
export function canCaptureScreen(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

/** רוחב מרבי לצילום. מעבר לזה זה משקל בלי מידע נוסף לתמיכה. */
const MAX_WIDTH = 1600;

/**
 * תקרת זמן לבקשת ההרשאה.
 *
 * `getDisplayMedia` אינו מבטיח לחזור: דפדפן שלא מציג בורר (סביבת
 * בדיקות, מדיניות ארגונית) משאיר את ההבטחה תלויה לנצח — ואיתה את
 * המשתמש מול הכיתוב "מצלם…" בלי דרך לצאת. דקה מספיקה בהחלט כדי
 * לבחור חלון, ומעבר לה עדיף לשלוח את הפנייה בלי צילום.
 */
const PERMISSION_TIMEOUT_MS = 60_000;

/**
 * פריים אחד מהמסך, כ-JPEG.
 *
 * מחזיר null כשהמשתמש ביטל את הבקשה — ביטול אינו שגיאה, והפנייה
 * ממשיכה בלי צילום.
 */
export async function captureScreen(): Promise<Blob | null> {
  if (!canCaptureScreen()) return null;
  let stream: MediaStream | null;
  try {
    const request = navigator.mediaDevices.getDisplayMedia({
      /*
       * `preferCurrentTab` נתמך ב-Chrome ובאדג' ומקדם את הלשונית
       * הנוכחית בבורר — בדיוק מה שרוצים כאן. דפדפן שלא מכיר אותו
       * מתעלם ממנו, ולכן אין צורך בבדיקה.
       */
      video: { frameRate: 1 },
      audio: false,
      preferCurrentTab: true,
    } as MediaStreamConstraints);
    stream = await Promise.race([
      request,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PERMISSION_TIMEOUT_MS)),
    ]);
    /*
     * אם פג הזמן והבקשה תתממש בכל זאת מאוחר יותר — עוצרים אותה, כדי
     * שלא תישאר נורית "משתפים מסך" דולקת בלי שום צילום.
     */
    if (stream === null) {
      void request.then((late) => {
        for (const track of late.getTracks()) track.stop();
      }).catch(() => undefined);
      return null;
    }
  } catch {
    return null;
  }

  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    /*
     * המתנה לפריים ממשי. `play()` חוזר לפני שיש תוכן, וציור מוקדם
     * מדי מייצר תמונה שחורה — כלומר "צילום מסך" שאין בו כלום.
     */
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        requestAnimationFrame(() => resolve());
        return;
      }
      video.onloadeddata = () => requestAnimationFrame(() => resolve());
    });

    const scale = Math.min(1, MAX_WIDTH / (video.videoWidth || MAX_WIDTH));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.72);
    });
  } catch {
    return null;
  } finally {
    // עצירת השידור בכל מסלול — נורית "משתפים מסך" שנשארת דולקת מבהילה
    for (const track of stream.getTracks()) track.stop();
  }
}
