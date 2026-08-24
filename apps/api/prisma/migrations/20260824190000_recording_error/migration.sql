-- למה משיכת ההקלטה נכשלה. בלי העמודה הזו כישלון הוא שקט מוחלט:
-- „אין הקלטה”, „ממתינה” ו„נכשלה” נראים על המסך אותו דבר.
ALTER TABLE "calls" ADD COLUMN "provider_recording_error" VARCHAR(60);
