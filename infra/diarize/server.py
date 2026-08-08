"""
זיהוי דוברים מקומי — pyannote.audio על CPU, בלי שום יציאה לאינטרנט
אחרי משיכת המודל הראשונית.

השירות הזה מחזיר *רק* תורי דיבור: מי דיבר ומתי, בלי טקסט. התמלול
עצמו נשאר בשירות stt (faster-whisper עם המודל המכוונן לעברית), והחיבור
בין השניים נעשה בצד ה-worker לפי חפיפה בזמן — ראו
packages/shared/src/logic/diarize.ts לנימוק המלא.

עקרונות זהים לשירות התמלול: האודיו נמחק מיד (finally), עיבוד מסודר
בתור, סוד משותף בהשוואה קבועת-זמן, ואין פורט חשוף לאינטרנט.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import subprocess
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from typing import Annotated

import torch
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pyannote.audio import Pipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("diarize")

MODEL_NAME = os.environ.get("DIARIZE_MODEL", "pyannote/speaker-diarization-3.1")
SHARED_SECRET = os.environ.get("STT_SECRET", "")
HF_TOKEN = os.environ.get("HF_TOKEN", "")
MAX_UPLOAD_BYTES = int(os.environ.get("STT_MAX_BYTES", str(25 * 1024 * 1024)))
CONCURRENCY = int(os.environ.get("DIARIZE_CONCURRENCY", "1"))
MAX_QUEUE = int(os.environ.get("DIARIZE_MAX_QUEUE", "3"))
# תקרת דוברים: שיחת טלפון היא כמעט תמיד שניים. בלי תקרה pyannote
# נוטה לפצל דובר אחד רועש לשלושה, ותמלול עם "דובר 4" מדומיין גרוע
# יותר מתמלול בלי תוויות בכלל.
MIN_SPEAKERS = int(os.environ.get("DIARIZE_MIN_SPEAKERS", "1"))
MAX_SPEAKERS = int(os.environ.get("DIARIZE_MAX_SPEAKERS", "4"))
CHUNK_BYTES = 1024 * 1024
SAMPLE_RATE = 16000

if not SHARED_SECRET:
    raise SystemExit(
        "STT_SECRET חסר — צרו סוד (openssl rand -hex 24) והוסיפו ל-.env.production"
    )

if not HF_TOKEN:
    # מודל זיהוי הדוברים סגור מאחורי אישור תנאים ב-Hugging Face. בלי
    # טוקן המשיכה נכשלת בבקשה הראשונה — עדיף להיעצר כאן עם הסבר.
    raise SystemExit(
        "HF_TOKEN חסר — צרו טוקן קריאה ב-Hugging Face ואשרו את התנאים של "
        "pyannote/speaker-diarization-3.1 ו-pyannote/segmentation-3.0. "
        "ראו docs/10-deployment.md §זיהוי דוברים."
    )

# מגביל את torch למספר החוטים שהוקצה — בלעדיו הוא תופס את כל הליבות
# ומרעיב את ה-API ואת שירות התמלול שרצים על אותו מארח.
torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "2")))

_pipeline: Pipeline | None = None
_pipeline_lock = threading.Lock()
_lock = asyncio.Semaphore(CONCURRENCY)
_inflight = 0


def get_pipeline() -> Pipeline:
    """טעינת הצינור פעם אחת, מוגן במנעול כדי שהחימום והבקשה הראשונה
    לא יטענו שני עותקים במקביל."""
    global _pipeline
    with _pipeline_lock:
        if _pipeline is None:
            logger.info("טוען מודל זיהוי דוברים: %s", MODEL_NAME)
            pipeline = Pipeline.from_pretrained(MODEL_NAME, use_auth_token=HF_TOKEN)
            if pipeline is None:
                # from_pretrained מחזיר None (ולא זורק) כשהטוקן תקין אך
                # התנאים של המודל לא אושרו — כישלון שקט שקשה לאבחן
                raise RuntimeError(
                    f"טעינת {MODEL_NAME} נכשלה — ודאו שאישרתם את תנאי המודל בחשבון ה-Hugging Face"
                )
            _pipeline = pipeline.to(torch.device("cpu"))
            logger.info("מודל זיהוי הדוברים נטען")
    return _pipeline


@asynccontextmanager
async def lifespan(_app: FastAPI):
    def warm() -> None:
        try:
            get_pipeline()
        except Exception:  # noqa: BLE001 — כשל חימום לא מפיל את השירות
            logger.exception("חימום מודל הדוברים נכשל — ננסה שוב בבקשה הראשונה")

    task = asyncio.create_task(asyncio.to_thread(warm))
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="metavchim-diarize", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "model": MODEL_NAME, "loaded": _pipeline is not None}


@app.post("/diarize")
async def diarize(
    file: Annotated[UploadFile, File()],
    x_stt_secret: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    if not hmac.compare_digest(x_stt_secret or "", SHARED_SECRET):
        raise HTTPException(status_code=401, detail="unauthorized")

    global _inflight
    if _inflight >= MAX_QUEUE:
        raise HTTPException(status_code=429, detail="busy")
    _inflight += 1

    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    tmp_path: str | None = None
    try:
        size = 0
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp_path = tmp.name
            while chunk := await file.read(CHUNK_BYTES):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="audio too large")
                tmp.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="empty audio")

        async with _lock:
            started = time.monotonic()
            turns = await asyncio.to_thread(_run, tmp_path)
            elapsed = time.monotonic() - started

        speakers = len({turn["speaker"] for turn in turns})
        logger.info("זוהו %d דוברים ב-%d תורים תוך %.1fs", speakers, len(turns), elapsed)
        return {"turns": turns, "speakerCount": speakers}
    finally:
        _inflight -= 1
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)  # האודיו לא נשאר על הדיסק


def _to_wav(path: str) -> str:
    """המרה ל-WAV 16kHz מונו.

    pyannote קורא דרך torchaudio, שלא מפענח webm/opus — הפורמט שבו
    הדפדפן מקליט. ffmpeg הוא אותו כלי שכבר משמש את שירות התמלול.
    """
    wav_path = f"{path}.wav"
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", path,
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", wav_path],
        capture_output=True,
        check=False,
        timeout=300,
    )
    if result.returncode != 0 or not os.path.exists(wav_path):
        # ffmpeg כותב פלט חלקי לפני שהוא נכשל — מנקים אותו כאן, כי
        # מרגע שנזרקת החריגה אין למי שקורא לנו את שם הקובץ
        if os.path.exists(wav_path):
            os.unlink(wav_path)
        raise HTTPException(status_code=400, detail="audio decode failed")
    return wav_path


def _run(path: str) -> list[dict[str, object]]:
    wav_path = _to_wav(path)
    try:
        pipeline = get_pipeline()
        annotation = pipeline(
            wav_path,
            min_speakers=MIN_SPEAKERS,
            max_speakers=MAX_SPEAKERS,
        )
        return [
            {
                "start": round(float(segment.start), 2),
                "end": round(float(segment.end), 2),
                "speaker": str(label),
            }
            for segment, _, label in annotation.itertracks(yield_label=True)
        ]
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)
