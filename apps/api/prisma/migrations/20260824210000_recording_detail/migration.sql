-- „לא נקראה” בלי עוד מילה אינו שימושי. הפירוט נבנה מצונזר:
-- שמות מפתחות, ערכים של שדות טכניים בלבד, בלי כתובות ובלי סודות.
ALTER TABLE "calls" ADD COLUMN "provider_recording_detail" VARCHAR(200);
