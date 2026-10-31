import ctypes
import inspect
import logging
import os
import re
import site
import sys
import tempfile
import time
from typing import Any, Optional, Tuple

# Ensure project root is on sys.path whether invoked as `py stt_service/app.py` or from inside `stt_service/`
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Ensure UTF-8 console logging on Windows so Filipino/Spanish characters never hit cp1252 errors
for _stream in (sys.stdout, sys.stderr):
    _reconf = getattr(_stream, "reconfigure", None)
    if callable(_reconf):
        try:
            _reconf(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _register_cuda_dll_directories() -> list[str]:
    """
    Automatically locate pip-installed NVIDIA CUDA runtime DLLs (nvidia-cublas-cu12,
    nvidia-cuda-nvrtc-cu12, cuDNN inside ctranslate2) on Windows BEFORE importing ctranslate2.
    """
    if os.name != "nt":
        return []

    candidates: list[str] = []
    search_roots = list(site.getsitepackages()) + [site.getusersitepackages()]
    for base in search_roots:
        if not base or not os.path.isdir(base):
            continue
        nvidia_root = os.path.join(base, "nvidia")
        if os.path.isdir(nvidia_root):
            try:
                for pkg in os.listdir(nvidia_root):
                    bin_dir = os.path.join(nvidia_root, pkg, "bin")
                    if os.path.isdir(bin_dir):
                        candidates.append(bin_dir)
            except Exception:
                pass
        ct2_dir = os.path.join(base, "ctranslate2")
        if os.path.isdir(ct2_dir):
            candidates.append(ct2_dir)

    added: list[str] = []
    current_path = os.environ.get("PATH", "")
    for directory in candidates:
        norm_dir = os.path.normpath(directory)
        if norm_dir not in added:
            added.append(norm_dir)
            if hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(norm_dir)
                except Exception:
                    pass
    if added:
        os.environ["PATH"] = os.pathsep.join(added) + os.pathsep + current_path
    return added


_REGISTERED_CUDA_DIRS = _register_cuda_dll_directories()

import ctranslate2
import edge_tts
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from faster_whisper import WhisperModel

try:
    from faster_whisper import BatchedInferencePipeline
except ImportError:
    BatchedInferencePipeline = None

from stt_service.transcript_refiner import refine_transcript
from stt_service.voice_cleaner import VoiceCleaner

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stt_service")

app = FastAPI(title="VAlumni faster-whisper GPU + VoiceCleaner Speech-to-Text API")

# Enable CORS for local client and Express server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Studio-Grade Vectorized DSP Voice Cleaner
voice_cleaner = VoiceCleaner(sample_rate=16000)

# Configuration & Zero-Config Hardware Auto-Tiering (GPU Workstation vs. Office CPU PC)
EXPLICIT_MODEL = os.getenv("WHISPER_MODEL", "").strip()
CPU_THREADS = max(4, min(8, os.cpu_count() or 4))

DEVICE = "cpu"
COMPUTE_TYPE = "int8"
HARDWARE_PROFILE = "office_cpu_optimized"

# Verify CUDA + cuBLAS availability for NVIDIA Tensor Core acceleration
if ctranslate2.get_cuda_device_count() > 0:
    try:
        if os.name == "nt":
            ctypes.cdll.LoadLibrary("cublas64_12.dll")
        supported_cuda_types = ctranslate2.get_supported_compute_types("cuda")
        DEVICE = "cuda"
        COMPUTE_TYPE = "int8_float16" if "int8_float16" in supported_cuda_types else "float16"
        HARDWARE_PROFILE = "gpu_tensor_core"
        logger.info(f"CUDA GPU and cuBLAS verified. Using Tensor Core acceleration ({DEVICE} / {COMPUTE_TYPE}).")
    except Exception as e:
        logger.info(f"CUDA cuBLAS unavailable ({e}). Auto-selecting Office CPU INT8 profile ({CPU_THREADS} threads).")
        DEVICE = "cpu"
        COMPUTE_TYPE = "int8"
        HARDWARE_PROFILE = "office_cpu_optimized"
else:
    logger.info(f"No NVIDIA GPU detected. Auto-selecting Office CPU INT8 profile ({CPU_THREADS} threads).")

# Auto-select model tier: 'large-v3-turbo' on NVIDIA GPUs; lightweight 'small' INT8 (~250MB RAM, 6.4x faster) on CPU-only Office PCs
MODEL_SIZE = EXPLICIT_MODEL or ("large-v3-turbo" if DEVICE == "cuda" else "small")


def _load_whisper_model(model_name: str, device: str, compute_type: str) -> WhisperModel:
    threads = CPU_THREADS if device == "cpu" else 0
    workers = 1 if device == "cpu" else 2
    try:
        return WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            cpu_threads=threads,
            num_workers=workers,
            local_files_only=True,
        )
    except Exception:
        return WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            cpu_threads=threads,
            num_workers=workers,
            local_files_only=False,
        )


logger.info(f"Loading Whisper model '{MODEL_SIZE}' on {DEVICE} ({COMPUTE_TYPE}, profile={HARDWARE_PROFILE})...")
try:
    model = _load_whisper_model(MODEL_SIZE, DEVICE, COMPUTE_TYPE)
    logger.info(f"Whisper model '{MODEL_SIZE}' loaded successfully on {DEVICE} ({COMPUTE_TYPE}).")
except Exception as e:
    logger.warning(f"Model load on {DEVICE} ({COMPUTE_TYPE}) failed ({e}). Falling back to Office CPU INT8 profile...")
    DEVICE = "cpu"
    COMPUTE_TYPE = "int8"
    HARDWARE_PROFILE = "office_cpu_optimized"
    MODEL_SIZE = EXPLICIT_MODEL or "small"
    model = _load_whisper_model(MODEL_SIZE, "cpu", "int8")
    logger.info(f"Whisper model '{MODEL_SIZE}' loaded successfully on CPU fallback ({CPU_THREADS} threads).")

batched_model = None
if BatchedInferencePipeline is not None:
    try:
        batched_model = BatchedInferencePipeline(model=model)
        logger.info("Initialized BatchedInferencePipeline for parallel long-answer transcription.")
    except Exception as e:
        logger.warning(f"BatchedInferencePipeline init note: {e}")

# Pre-warm CUDA / CTranslate2 kernels at startup so the very first user turn has zero cold-start lag
try:
    _warm_segs, _ = model.transcribe(
        np.zeros(8000, dtype=np.float32),
        beam_size=1,
        without_timestamps=True,
        vad_filter=False,
        language="tl",
    )
    list(_warm_segs)
    logger.info("Whisper inference kernels warmed and ready.")
except Exception as e:
    logger.warning(f"Warm-up note: {e}")

_MODEL_PARAMS = inspect.signature(model.transcribe).parameters
_SUPPORTS_HOTWORDS = "hotwords" in _MODEL_PARAMS
_SUPPORTS_LANG_DET_SEGMENTS = "language_detection_segments" in _MODEL_PARAMS

# Stage-specific bilingual Taglish prompts & hotwords priming Whisper's decoder KV-cache for Filipino names & CCS vocabulary
STAGE_DECODING_PROFILES = {
    1: (
        "Magandang araw po, ang buong pangalan ko po at student ID bilang graduate ng BSIT at BSCS sa LSPU College of Computer Studies. "
        "Surnames: Hornilla, Coronacion, Urrea, Dela Cruz, Bautista, Villanueva, Dimaculangan, Catapang, Macaraig, Agoncillo, Montecillo, Peñaranda, Eleazar, Tolentino, Quemada.",
        "Hornilla Coronacion Urrea Dela Cruz Bautista Villanueva Dimaculangan Catapang Macaraig Agoncillo Peñaranda BSIT BSCS LSPU CCS",
    ),
    2: (
        "Sa core programming at electives ng CCS curriculum, ang rating ko ay 4 out of 5. "
        "Sa tech stack, nakatulong ang Python, Java, HTML, CSS, JavaScript, TypeScript, PHP, SQL, MySQL, PostgreSQL, C++, C#, React.js, Node.js, Laravel, Flutter, Docker, AWS, Cloud, at DevOps.",
        "core programming electives curriculum tech stack Python Java JavaScript TypeScript HTML CSS PHP SQL MySQL PostgreSQL React.js Node.js Laravel Flutter Docker AWS DevOps",
    ),
    3: (
        "Sa IT laboratory facilities, PC workstation specs, RAM, SSD, IDE software gaya ng VS Code at Android Studio, campus Wi-Fi, internet connectivity, latency, at aircon, ang rating ko ay 4 out of 5.",
        "IT laboratory PC workstation hardware specs RAM SSD IDE VS Code Visual Studio Android Studio campus Wi-Fi internet connectivity latency boot time aircon grievance",
    ),
    4: (
        "Sa Capstone project mentorship, thesis, technical guidance ng adviser, deployment, defense, at IT internship practicum o OJT, ang rating ko ay 5 out of 5.",
        "Capstone project thesis mentorship adviser technical guidance IT internship OJT practicum deployment defense",
    ),
    5: (
        "Employed full-time na po ako bilang software developer, web developer, QA engineer, o data analyst. Mataas ang confidence ko sa technical coding interviews, at bukas po akong bumalik bilang alumni guest speaker o industry mentor sa CCS.",
        "employed full-time part-time freelancing software developer web developer QA engineer data analyst coding interview guest speaker industry mentor CCS",
    ),
    6: (
        "Ang pinaka-rewarding breakthrough ko sa CCS ay debugging at deployment ng Capstone project. Sana ma-improve ang enrollment at defense schedule, at golden advice ko sa freshmen ay mag-aral ng Git, GitHub, version control, at portfolio.",
        "breakthrough debugging Capstone defense deployment enrollment grading freshmen Git GitHub version control portfolio self-study",
    ),
}

DEFAULT_PROFILE = (
    "Opo, bilang graduate ng BSIT at BSCS sa LSPU College of Computer Studies, pag-usapan natin ang core programming, electives, tech stack, Python, HTML, CSS, JavaScript, SQL, Capstone project, at Wi-Fi. "
    "Names: Hornilla, Coronacion, Urrea, Dela Cruz, Bautista, Villanueva, Dimaculangan, Catapang, Macaraig.",
    "LSPU CCS BSIT BSCS electives tech stack HTML CSS Python JavaScript SQL React.js Node.js Wi-Fi Capstone Hornilla Coronacion Urrea Dela Cruz",
)


def _select_decoding_profile(stage: Optional[int], field_hint: Optional[str]) -> Tuple[str, str]:
    hint = (field_hint or "").strip().lower()
    if hint in ("lastname", "firstname", "middleinitial", "demo_lastname", "demo_firstname", "demo_middleinitial", "demo_studentid", "name"):
        return STAGE_DECODING_PROFILES[1]
    if stage in STAGE_DECODING_PROFILES:
        return STAGE_DECODING_PROFILES[stage]
    return DEFAULT_PROFILE


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "faster-whisper",
        "voice_cleaner": "active (Vectorized STFT Wiener + Bandpass + -18dBFS Norm + Lexicon Refiner)",
        "batched_long_form": batched_model is not None,
        "hardware_profile": HARDWARE_PROFILE,
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    }


@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    stage: Optional[int] = Form(default=None),
    field_hint: Optional[str] = Form(default=None),
):
    """
    Clean uploaded speech via vectorized VoiceCleaner DSP pipeline, transcribe rapidly
    using GPU Tensor Cores (or Office CPU INT8 fast profile), and refine domain/Filipino names.
    """
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_path = temp_file.name
    temp_file.close()

    try:
        t_start = time.perf_counter()
        content = await file.read()
        if not content or len(content) < 100:
            raise HTTPException(status_code=400, detail="Empty or invalid audio payload.")

        with open(temp_path, "wb") as f:
            f.write(content)

        # 1. Run Vectorized Studio-Grade DSP Voice Cleaner
        t_clean0 = time.perf_counter()
        cleaned_audio, cleaner_metrics = voice_cleaner.clean_audio(temp_path)
        clean_ms = round((time.perf_counter() - t_clean0) * 1000.0, 1)

        if cleaner_metrics.get("is_silent"):
            logger.info(f"VoiceCleaner detected silent clip ({clean_ms}ms); skipping ASR.")
            return {
                "success": True,
                "transcript": "",
                "raw_transcript": "",
                "detected_language": None,
                "duration": cleaner_metrics.get("raw_duration_sec", 0.0),
                "timing_ms": {"clean_ms": clean_ms, "asr_ms": 0.0, "total_ms": clean_ms},
                "voice_cleaner": cleaner_metrics,
                "model": MODEL_SIZE,
                "device": DEVICE,
                "compute_type": COMPUTE_TYPE,
            }

        initial_prompt, hotwords = _select_decoding_profile(stage, field_hint)
        audio_duration_sec = len(cleaned_audio) / 16000.0

        vad_params = dict(
            threshold=0.35,
            min_speech_duration_ms=140,
            min_silence_duration_ms=400,
            speech_pad_ms=280,
        )

        # Adapt beam & temperature strategy to hardware tier (GPU vs CPU-only Office PC)
        is_gpu = DEVICE == "cuda"
        beam_sz = 3 if is_gpu else (2 if audio_duration_sec <= 16.0 else 1)
        temp_schedule = [0.0, 0.2] if is_gpu else 0.0

        common_kwargs: dict[str, Any] = dict(
            beam_size=beam_sz,
            temperature=temp_schedule,
            compression_ratio_threshold=2.6,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.65,
            initial_prompt=initial_prompt,
            condition_on_previous_text=False,
            without_timestamps=True,
            vad_filter=True,
            vad_parameters=vad_params,
            language=None,
        )
        if _SUPPORTS_HOTWORDS and hotwords:
            common_kwargs["hotwords"] = hotwords
        if _SUPPORTS_LANG_DET_SEGMENTS:
            common_kwargs["language_detection_segments"] = 1

        # 2. Fast GPU / Office-CPU Batched Long-Form ASR Decoding
        t_asr0 = time.perf_counter()
        used_batched = False

        if batched_model is not None and audio_duration_sec > 20.0:
            try:
                used_batched = True
                batch_sz = 8 if is_gpu else 4
                segments, info = batched_model.transcribe(
                    cleaned_audio,
                    batch_size=batch_sz,
                    chunk_length=25,
                    **common_kwargs,
                )
                transcript_segments = [
                    seg.text.strip()
                    for seg in segments
                    if seg.text.strip()
                    and not (getattr(seg, "no_speech_prob", 0.0) > 0.68 and getattr(seg, "avg_logprob", 0.0) < -1.0)
                ]
            except Exception as batch_err:
                logger.warning(f"Batched decode fallback to sequential ({batch_err})")
                used_batched = False
                segments, info = model.transcribe(cleaned_audio, best_of=beam_sz, **common_kwargs)
                transcript_segments = [
                    seg.text.strip()
                    for seg in segments
                    if seg.text.strip()
                    and not (getattr(seg, "no_speech_prob", 0.0) > 0.68 and getattr(seg, "avg_logprob", 0.0) < -1.0)
                ]
        else:
            segments, info = model.transcribe(cleaned_audio, best_of=beam_sz, **common_kwargs)
            transcript_segments = [
                seg.text.strip()
                for seg in segments
                if seg.text.strip()
                and not (getattr(seg, "no_speech_prob", 0.0) > 0.68 and getattr(seg, "avg_logprob", 0.0) < -1.0)
            ]

        raw_transcript = " ".join(transcript_segments).strip()

        # 3. Context-aware domain & Philippine name lexicon refinement
        refined_transcript = refine_transcript(raw_transcript, stage=stage, field_hint=field_hint)

        asr_ms = round((time.perf_counter() - t_asr0) * 1000.0, 1)
        total_ms = round((time.perf_counter() - t_start) * 1000.0, 1)

        logger.info(
            f"Transcribed {info.duration:.1f}s [{info.language}, {DEVICE}/{COMPUTE_TYPE}, "
            f"{'batched' if used_batched else 'direct'}, clean={clean_ms}ms, asr={asr_ms}ms, total={total_ms}ms]: "
            f"raw='{raw_transcript}' -> refined='{refined_transcript}'"
        )

        return {
            "success": True,
            "transcript": refined_transcript,
            "raw_transcript": raw_transcript,
            "detected_language": info.language,
            "duration": round(info.duration, 2),
            "timing_ms": {
                "clean_ms": clean_ms,
                "asr_ms": asr_ms,
                "total_ms": total_ms,
            },
            "voice_cleaner": cleaner_metrics,
            "model": MODEL_SIZE,
            "device": DEVICE,
            "compute_type": COMPUTE_TYPE,
        }

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error during transcription: {err}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(err)}")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@app.post("/tts")
async def generate_speech(payload: dict):
    """
    Generate natural human neural audio for Program Head using Azure Neural voices.
    Supports authentic Filipino and Philippine English (AngeloNeural, JamesNeural, BlessicaNeural).
    """
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    cleaned_text = re.sub(r"[*_#`~]", "", text).strip()

    voice = payload.get("voice") or "fil-PH-AngeloNeural"
    rate = payload.get("rate") or "-4%"
    pitch = payload.get("pitch") or "+0Hz"

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

    uvicorn.run(app, host="127.0.0.1", port=8000)
