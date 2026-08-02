"""
שירות תמלול מקומי — faster-whisper על CPU, בלי שום יציאה לאינטרנט
אחרי משיכת המודל הראשונית.

עקרונות:
- האודיו נכתב לקובץ זמני, מתומלל, ונמחק מיד (finally) — לא נשמר בדיסק.
- עיבוד מסודר בתור (Semaphore): שתי בקשות במקביל היו חונקות את כל
  ליבות ה-CPU ומאטות את המערכת לכל המשתמשים.
- הסוד המשותף עם ה-API נבדק בהשוואה קבועת-זמן; השירות מאזין רק
  ברשת הפנימית של compose (אין פורט חשוף לאינטרנט).
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import tempfile
from typing import Annotated

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stt")

MODEL_NAME = os.environ.get("STT_MODEL", "ivrit-ai/whisper-large-v3-turbo-ct2")
COMPUTE_TYPE = os.environ.get("STT_COMPUTE_TYPE", "int8")
LANGUAGE = os.environ.get("STT_LANGUAGE", "he")
SHARED_SECRET = os.environ.get("STT_SECRET", "")
MAX_UPLOAD_BYTES = int(os.environ.get("STT_MAX_BYTES", str(25 * 1024 * 1024)))
# תמלול אחד בכל רגע — הגנה על זמני התגובה של שאר המערכת
CONCURRENCY = int(os.environ.get("STT_CONCURRENCY", "1"))

if not SHARED_SECRET:
    # בלי סוד משותף כל מי שברשת הפנימית יכול לתמלל — עצירה מיידית
    # עם הודעה ברורה, במקום שירות פתוח בשקט.
    raise SystemExit(
        "STT_SECRET חסר — צרו סוד (openssl rand -hex 24) והוסיפו ל-.env.production"
    )

app = FastAPI(title="metavchim-stt", docs_url=None, redoc_url=None)
_model: WhisperModel | None = None
_lock = asyncio.Semaphore(CONCURRENCY)


def get_model() -> WhisperModel:
    """טעינה עצלה — הקונטיינר עולה מיד, המודל נטען בבקשה הראשונה."""
    global _model
    if _model is None:
        logger.info("טוען מודל תמלול: %s (%s)", MODEL_NAME, COMPUTE_TYPE)
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type=COMPUTE_TYPE)
        logger.info("המודל נטען")
    return _model


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "model": MODEL_NAME, "loaded": _model is not None}


@app.post("/transcribe")
async def transcribe(
    file: Annotated[UploadFile, File()],
    x_stt_secret: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    if SHARED_SECRET and not hmac.compare_digest(x_stt_secret or "", SHARED_SECRET):
        raise HTTPException(status_code=401, detail="unauthorized")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(audio) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio)
            tmp_path = tmp.name

        async with _lock:
            # ריצת המודל היא CPU-bound — מועברת ל-thread כדי לא לחסום
            # את לולאת האירועים (בדיקת הבריאות ממשיכה לענות)
            text, duration = await asyncio.to_thread(_run, tmp_path)

        return {"text": text, "durationSeconds": duration}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)  # האודיו לא נשאר על הדיסק


def _run(path: str) -> tuple[str, float]:
    model = get_model()
    segments, info = model.transcribe(
        path,
        language=LANGUAGE,
        beam_size=5,
        vad_filter=True,  # מסנן שקט — מקצר את הזמן ומונע הזיות
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,  # מונע גרירת הזיות בין קטעים
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return text, float(info.duration)
