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

RUN pip install --no-cache-dir \
  "faster-whisper==1.1.0" \
  "fastapi==0.115.6" \
  "uvicorn[standard]==0.34.0" \
  "python-multipart==0.0.20"

COPY server.py /app/server.py

# מטמון המודלים — ממופה ל-volume כדי לא למשוך בכל עלייה
ENV HF_HOME=/models
EXPOSE 9000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9000", "--workers", "1"]
