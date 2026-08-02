# ============================================================
# שירות תמלול מקומי — faster-whisper (CTranslate2) על CPU.
# ההקלטות לעולם לא יוצאות מהשרת: אין קריאה לשום ספק חיצוני,
# והאודיו נמחק מיד אחרי התמלול (docs/04 — פרטיות).
#
# המודל נמשך פעם אחת בעליית הקונטיינר ונשמר ב-volume, כך
# שהפעלות הבאות מיידיות.
# ============================================================
FROM python:3.12-slim

# ffmpeg נדרש לפענוח האודיו שמגיע מהדפדפן (webm/opus)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# requests ו-huggingface-hub מוצמדים במפורש: faster-whisper 1.1.0 עושה
# `import requests` בלי להצהיר עליו, והוא הגיע בעקיפין דרך huggingface-hub.
# מאז ש-huggingface-hub 1.x עבר ל-httpx החבילה הפסיקה להגיע — והקונטיינר
# נפל בלולאת ריסטרט עם ModuleNotFoundError.
RUN pip install --no-cache-dir \
  "faster-whisper==1.1.0" \
  "huggingface-hub==0.27.1" \
  "requests==2.32.3" \
  "fastapi==0.115.6" \
  "uvicorn[standard]==0.34.0" \
  "python-multipart==0.0.20"

# בדיקת עשן בזמן הבנייה: תלות חסרה נופלת כאן, לא בלולאת ריסטרט על השרת
RUN python -c "import faster_whisper, fastapi, multipart, requests"

COPY server.py /app/server.py

# מטמון המודלים — ממופה ל-volume כדי לא למשוך בכל עלייה
ENV HF_HOME=/models
EXPOSE 9000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9000", "--workers", "1"]
