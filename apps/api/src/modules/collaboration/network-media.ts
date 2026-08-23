/**
 * כתובות התמונות של הרשת — נתיבים ב-API, לא כתובות חתומות לאחסון.
 *
 * ## למה לא כתובת חתומה
 *
 * כל שאר המדיה במערכת זורמת דרך ה-API (`storage.getObject`), בדיוק
 * כפי שכתוב בשירות האחסון: „בפרודקשן MinIO על רשת פנימית בלבד, ללא
 * כתובת ציבורית”. שלושה מקומות ברשת השיתופים חרגו מזה וחתמו כתובת
 * שנשלחה לדפדפן — לוגו המשרד, תמונות מודעה, ותמונות נכס בהצעה.
 *
 * חתימת SigV4 כוללת את ה-Host, ולכן כתובת כזו נשברת בשתי דרכים:
 * אם `S3_ENDPOINT` הוא הכתובת הפנימית (`http://minio:9000`) הדפדפן
 * אינו יכול להגיע אליה כלל, ואם היא מוסבת דרך שער ה-HTTPS החתימה
 * כבר אינה תואמת ל-Host שהגיע — `SignatureDoesNotMatch`.
 *
 * הנתיבים כאן פותרים את שניהם: הדפדפן פונה ל-API באותו מקור, עם
 * העוגייה שכבר יש לו, וה-API מזרים את הקובץ אחרי בדיקת הרשאה
 * מפורשת. אין חתימה שאפשר לשבור, ואין כתובת שפגה אחרי שעה.
 *
 * ## למה נתיב יחסי
 *
 * הבסיס (`/api/v1` בפרודקשן, `http://localhost:3001/api/v1` בפיתוח)
 * ידוע ל-web בזמן הבנייה ולא ל-API. הצד השני מרכיב אותו.
 */

/** לוגו המשרד המפרסם — נראה בכל כרטיס בפיד. */
export function officeLogoPath(tenantId: string): string {
  return `collaboration/office/${tenantId}/logo`;
}

/** תמונה מגלריית מודעה שפורסמה לרשת. */
export function listingPhotoPath(listingId: string, index: number): string {
  return `collaboration/listings/${listingId}/photo/${index}`;
}

/** תמונת נכס שצורף להצעת שיתוף שנשלחה למשרד הצופה. */
export function offerPhotoPath(offerId: string, index: number): string {
  return `collaboration/offers/${offerId}/photo/${index}`;
}
