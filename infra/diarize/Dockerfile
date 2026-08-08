# ============================================================
# שירות זיהוי דוברים — pyannote.audio על CPU.
#
# למה קונטיינר נפרד ולא הרחבה של infra/stt: התלויות כאן (torch)
# מכפילות את גודל התמונה, וההכתבה לשדה — שרצה על כל מסך במערכת
# ומודדת את עצמה במילישניות — לא צריכה מהן כלום. הפרדה שומרת על
# שירות התמלול קטן ומהיר, ומאפשרת להריץ זיהוי דוברים רק במשרדים
# שבאמת מקליטים שיחות טלפון.
#
# המודל סגור מאחורי אישור תנאים ב-Hugging Face — ראו
# docs/10-deployment.md §זיהוי דוברים.
# ============================================================
FROM python:3.12-slim

# ffmpeg נדרש לפענוח webm/opus — torchaudio לא קורא את הפורמט הזה
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch מגלגל CUDA כברירת מחדל (~2.5GB שלא ישמשו לכלום על CPU).
# אינדקס ה-CPU מוריד את התמונה בסדר גודל.
RUN pip install --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cpu \
  "torch==2.5.1" \
  "torchaudio==2.5.1"

# huggingface-hub מוצמד ל-0.x מאותה סיבה שבשירות התמלול: 1.x שינה
# את שכבת ה-HTTP והפיל תלויות שסמכו על הישן.
RUN pip install --no-cache-dir \
  "pyannote.audio==3.3.2" \
  "huggingface-hub==0.27.1" \
  "fastapi==0.115.6" \
  "uvicorn[standard]==0.34.0" \
  "python-multipart==0.0.20"

# בדיקת עשן בזמן הבנייה: תלות חסרה נופלת כאן, לא בלולאת ריסטרט
RUN python -c "import torch, torchaudio, fastapi, multipart; from pyannote.audio import Pipeline"

COPY server.py /app/server.py

ENV HF_HOME=/models
EXPOSE 9001

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9001", "--workers", "1"]
