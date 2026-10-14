import os
import tempfile
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stt_service")

app = FastAPI(title="VAlumni faster-whisper Speech-to-Text API")

# Enable CORS for local client and Express server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3-turbo")

# Determine optimal device and compute type
import ctranslate2

DEVICE = "cpu"
COMPUTE_TYPE = "int8"

# Verify if CUDA is fully supported with cuBLAS libraries
if ctranslate2.get_cuda_device_count() > 0:
    try:
        # Probe cublas library availability
        import ctypes
        ctypes.cdll.LoadLibrary("cublas64_12.dll")
        DEVICE = "cuda"
        COMPUTE_TYPE = "float16"
        logger.info(f"CUDA device and cuBLAS verified. Using GPU acceleration ({COMPUTE_TYPE}).")
    except Exception as e:
        logger.info(f"CUDA cuBLAS DLL not found in system PATH ({e}). Using optimized CPU INT8 mode.")
        DEVICE = "cpu"
        COMPUTE_TYPE = "int8"

logger.info(f"Loading Whisper model '{MODEL_SIZE}' on {DEVICE} ({COMPUTE_TYPE})...")
try:
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    logger.info(f"Whisper model loaded successfully on {DEVICE} ({COMPUTE_TYPE}).")
except Exception as e:
    logger.warning(f"Model load on {DEVICE} failed ({e}). Falling back to CPU INT8...")
    DEVICE = "cpu"
    COMPUTE_TYPE = "int8"
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    logger.info("Whisper model loaded successfully on CPU fallback.")

# Domain prompt primes Whisper with LSPU CCS context, Philippine terminology, computing acronyms, and local surnames
DOMAIN_INITIAL_PROMPT = (
    "Laguna State Polytechnic University, LSPU, College of Computer Studies, CCS, "
    "Alumni Exit Interview, BSIT, BSCS, Capstone Project, Software Engineering, Python, JavaScript, Java, "
    "Philippine and Laguna surnames: Coronacion, Urrea, Dela Cruz, Santos, Reyes, Ramos, Mendoza, "
    "Gonzales, Hornilla, Dimaculangan, Catapang, Agoncillo, Macaraig, Quemada, Tolentino, Alipon, "
    "Carait, Eleazar, Reventar, Alimagno, Montecillo, Peñaranda, Peñaloza, Bathan, Bautista, Villanueva."
)

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "faster-whisper",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE
    }

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe audio upload (e.g. webm, wav, mp3, ogg, m4a) using Whisper Large-v3-Turbo.
    """
    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_path = temp_file.name

    try:
        content = await file.read()
        if not content or len(content) < 100:
            raise HTTPException(status_code=400, detail="Empty or invalid audio payload.")

        with open(temp_path, "wb") as f:
            f.write(content)

        logger.info(f"Transcribing audio file: {temp_path} ({len(content)} bytes)")

        # Run faster-whisper transcription with multilingual auto-detection (English, Tagalog, Taglish)
        segments, info = model.transcribe(
            temp_path,
            beam_size=5,
            initial_prompt=DOMAIN_INITIAL_PROMPT,
            vad_filter=True, # Filter out background silence
            vad_parameters=dict(min_silence_duration_ms=500),
            language=None # Auto-detects English vs Tagalog/Filipino vs Taglish
        )

        transcript_segments = []
        for segment in segments:
            transcript_segments.append(segment.text.strip())

        full_transcript = " ".join(transcript_segments).strip()
        logger.info(f"Transcription complete: '{full_transcript}' (Language: {info.language}, Duration: {info.duration:.1f}s)")

        return {
            "success": True,
            "transcript": full_transcript,
            "detected_language": info.language,
            "duration": round(info.duration, 2),
            "model": MODEL_SIZE,
            "device": DEVICE
        }

    except Exception as err:
        logger.error(f"Error during transcription: {err}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(err)}")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

import edge_tts
from fastapi.responses import Response

@app.post("/tts")
async def generate_speech(payload: dict):
    """
    Generate natural human neural audio for Program Head using Azure Neural voices.
    Supports authentic Filipino and Philippine English (AngeloNeural, JamesNeural, BlessicaNeural).
    """
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    # Remove any markdown formatting before synthesis
    import re
    cleaned_text = re.sub(r'[*_#`~]', '', text).strip()

    voice = payload.get("voice") or "fil-PH-AngeloNeural"
    rate = payload.get("rate") or "+0%"
    pitch = payload.get("pitch") or "-2Hz"

    try:
        communicate = edge_tts.Communicate(cleaned_text, voice, rate=rate, pitch=pitch)
        audio_chunks = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_chunks.extend(chunk["data"])

        return Response(content=bytes(audio_chunks), media_type="audio/mpeg")
    except Exception as err:
        logger.error(f"TTS generation error: {err}")
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(err)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)

