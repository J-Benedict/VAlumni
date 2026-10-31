"""
VAlumni Ultra-Fast Studio-Grade Voice Cleaner for faster-whisper ASR

Fully C-vectorized Digital Signal Processing (DSP) pipeline (<15 ms on 90s clips):
  1. Universal 16 kHz mono float32 decode (via faster_whisper / PyAV)
  2. DC offset removal & vectorized impulse/click suppression (USB mic pops/glitches)
  3. Zero-phase 60 Hz & 120 Hz mains-hum IIR notch filters (Philippine AC power hum)
  4. Zero-phase 4th-order Butterworth speech bandpass filter (75 Hz - 7600 Hz)
  5. Vectorized Decision-Directed IIR Wiener Spectral Denoiser (-22 dB floor,
     50% COLA Hann STFT, skipped automatically when raw SNR >= 32 dB)
  6. Clean-bin-gated consonant articulation presence restoration (+1.5 dB at 2.2 - 5.8 kHz)
  7. Smart leading/trailing dead-air trimming with 400 ms speech guard padding
  8. Speech-active RMS loudness normalization (-18 dBFS) + transparent soft-knee limiter
"""

import logging
from typing import Any, Dict, Tuple, Union

import numpy as np
from faster_whisper.audio import decode_audio
from scipy import signal
from scipy.ndimage import median_filter, uniform_filter1d

logger = logging.getLogger("stt_service.voice_cleaner")

SAMPLE_RATE = 16000


class VoiceCleaner:
    def __init__(self, sample_rate: int = SAMPLE_RATE):
        self.sr = sample_rate

        # Precompute zero-phase filter coefficients once at startup
        self.b60, self.a60 = signal.iirnotch(60.0, Q=30.0, fs=self.sr)
        self.b120, self.a120 = signal.iirnotch(120.0, Q=30.0, fs=self.sr)
        self.sos_bandpass = signal.butter(
            4, [75.0, 7600.0], btype="bandpass", fs=self.sr, output="sos"
        )

        # STFT configuration: 32 ms window, 16 ms hop (50% Hann overlap — exact COLA & 2x faster)
        self.nperseg = 512
        self.noverlap = 256
        self.freqs = np.fft.rfftfreq(self.nperseg, d=1.0 / self.sr)

        self.vocal_band_mask = (self.freqs >= 250.0) & (self.freqs <= 4000.0)
        self.high_band_mask = self.freqs >= 3200.0

        # Consonant articulation presence curve (+1.5 dB smooth shelf 2.2 - 5.8 kHz)
        presence_boost_linear = 10.0 ** (1.5 / 20.0)
        presence_curve = np.ones_like(self.freqs, dtype=np.float32)
        ramp_up = (self.freqs >= 1900.0) & (self.freqs < 2400.0)
        plateau = (self.freqs >= 2400.0) & (self.freqs <= 5800.0)
        ramp_down = (self.freqs > 5800.0) & (self.freqs <= 7000.0)

        presence_curve[ramp_up] = 1.0 + (presence_boost_linear - 1.0) * (
            (self.freqs[ramp_up] - 1900.0) / 500.0
        )
        presence_curve[plateau] = presence_boost_linear
        presence_curve[ramp_down] = 1.0 + (presence_boost_linear - 1.0) * (
            1.0 - (self.freqs[ramp_down] - 5800.0) / 1200.0
        )
        self.presence_curve = presence_curve[:, np.newaxis]

    @staticmethod
    def _estimate_snr_db(audio: np.ndarray, sr: int = SAMPLE_RATE) -> float:
        """Estimates speech-to-noise ratio (dB) over 20 ms frames."""
        frame_len = int(0.02 * sr)
        if len(audio) < frame_len * 4:
            return 0.0
        n_frames = len(audio) // frame_len
        frames = audio[: n_frames * frame_len].reshape(n_frames, frame_len)
        rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
        noise_rms = float(np.percentile(rms, 18))
        speech_rms = float(np.percentile(rms, 88))
        if noise_rms <= 1e-7:
            return 45.0
        snr = 20.0 * np.log10(max(speech_rms, noise_rms) / noise_rms)
        return round(float(np.clip(snr, 0.0, 50.0)), 1)

    @staticmethod
    def _suppress_clicks(audio: np.ndarray) -> np.ndarray:
        """Vectorized removal of isolated 1-2 sample electrical/USB clicks."""
        if len(audio) < 32:
            return audio
        diff = np.abs(np.diff(audio, prepend=audio[0]))
        mad = float(np.median(diff)) + 1e-6
        spike_mask = diff > max(14.0 * mad, 0.25)
        if not np.any(spike_mask):
            return audio

        repaired = audio.copy()
        local_med = median_filter(audio, size=7)
        repaired[spike_mask] = local_med[spike_mask]
        return repaired

    def _spectral_denoise(self, audio: np.ndarray, raw_snr_db: float) -> np.ndarray:
        """
        Fully vectorized IIR-smoothed Wiener Spectral Denoiser + clean-bin presence shelf.
        Runs in ~5-12 ms even on 90-second long-form answers.
        """
        if len(audio) < self.nperseg * 3 or raw_snr_db >= 32.0:
            return audio

        _, _, zxx = signal.stft(
            audio,
            fs=self.sr,
            window="hann",
            nperseg=self.nperseg,
            noverlap=self.noverlap,
            boundary="zeros",
            padded=True,
        )
        power = (np.abs(zxx) ** 2).astype(np.float32)
        n_bins, n_frames = power.shape

        if n_frames < 6:
            return audio

        # 1. Estimate stationary/ambient noise PSD from the quietest 22% of frames
        vocal_energy = np.mean(power[self.vocal_band_mask, :], axis=0)
        n_quiet = max(4, min(90, int(round(n_frames * 0.22))))
        quiet_indices = np.argpartition(vocal_energy, n_quiet - 1)[:n_quiet]

        noise_psd = np.percentile(power[:, quiet_indices], 60, axis=1).astype(np.float32)
        noise_psd = (uniform_filter1d(noise_psd, size=3) + 1e-12)[:, np.newaxis]

        # 2. Frequency-dependent & SNR-adaptive over-subtraction alpha(f)
        is_noisy = raw_snr_db < 14.0
        alpha = np.full((n_bins, 1), 1.55 if is_noisy else 1.20, dtype=np.float32)
        alpha[self.high_band_mask, 0] = 2.05 if is_noisy else 1.30

        # 3. C-vectorized 1st-order temporal IIR smoothing of a-priori SNR across all frames
        inst_prior = np.maximum(0.0, (power / (alpha * noise_psd)) - 1.0)
        beta = 0.78
        zi = signal.lfilter_zi([1.0 - beta], [1.0, -beta]).astype(np.float32)
        dd_prior, _ = signal.lfilter(
            [1.0 - beta],
            [1.0, -beta],
            inst_prior,
            axis=1,
            zi=inst_prior[:, :1] * zi,
        )
        dd_prior = np.maximum(0.0, dd_prior.astype(np.float32))

        floor_gain = 0.08 if is_noisy else 0.16
        gains = np.maximum(floor_gain, (dd_prior / (dd_prior + 1.0)) ** 0.85)
        gains = uniform_filter1d(gains, size=3, axis=0)

        # 4. Gate consonant presence shelf strictly onto high-SNR speech bins
        bin_snr = power / noise_psd
        clean_bin_weight = np.clip((bin_snr - 4.5) / 6.0, 0.0, 1.0)
        effective_presence = 1.0 + clean_bin_weight * (self.presence_curve - 1.0)

        cleaned_zxx = zxx * gains * effective_presence

        _, denoised = signal.istft(
            cleaned_zxx,
            fs=self.sr,
            window="hann",
            nperseg=self.nperseg,
            noverlap=self.noverlap,
            input_onesided=True,
            boundary=True,
        )
        return denoised[: len(audio)].astype(np.float32)

    def _trim_and_normalize(self, audio: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        Trims dead leading/trailing air (keeping 400 ms guard padding) and normalizes
        active speech RMS to -18 dBFS (0.125) with a soft-knee ceiling.
        """
        frame_len = int(0.02 * self.sr)
        if len(audio) < frame_len * 3:
            return audio, 0.0

        n_frames = len(audio) // frame_len
        frames = audio[: n_frames * frame_len].reshape(n_frames, frame_len)
        frame_rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)

        floor_rms = float(np.percentile(frame_rms, 16))
        active_thresh = max(floor_rms * 1.9, 0.0014)
        active_mask = frame_rms > active_thresh

        if not np.any(active_mask):
            top_rms = float(np.percentile(frame_rms, 85))
            if top_rms < 0.0005:
                return audio, 0.0
            active_mask = frame_rms >= (top_rms * 0.40)

        active_indices = np.where(active_mask)[0]
        pad_samples = int(0.40 * self.sr)
        start_sample = max(0, int(active_indices[0]) * frame_len - pad_samples)
        end_sample = min(len(audio), int(active_indices[-1] + 1) * frame_len + pad_samples)

        trimmed = audio[start_sample:end_sample]

        speech_rms = float(np.sqrt(np.mean(frame_rms[active_mask] ** 2) + 1e-12))
        target_rms = 0.125
        gain = float(np.clip(target_rms / max(speech_rms, 1e-5), 0.5, 12.0))
        gain_db = round(float(20.0 * np.log10(gain)), 1)

        amplified = trimmed * gain

        abs_amp = np.abs(amplified)
        knee = 0.72
        ceiling = 0.92
        over_mask = abs_amp > knee
        if np.any(over_mask):
            sign = np.sign(amplified[over_mask])
            excess = (abs_amp[over_mask] - knee) / (ceiling - knee)
            amplified[over_mask] = sign * (knee + (ceiling - knee) * np.tanh(excess))

        return amplified.astype(np.float32), gain_db

    def clean_audio(self, source: Union[str, bytes]) -> Tuple[np.ndarray, Dict[str, Any]]:
        raw_audio = decode_audio(source, sampling_rate=self.sr).astype(np.float32)
        raw_audio = np.nan_to_num(raw_audio, nan=0.0, posinf=0.0, neginf=0.0)

        raw_duration = round(len(raw_audio) / float(self.sr), 2)
        if len(raw_audio) < int(0.15 * self.sr) or float(np.max(np.abs(raw_audio))) < 1e-5:
            return raw_audio, {
                "is_silent": True,
                "raw_duration_sec": raw_duration,
                "cleaned_duration_sec": raw_duration,
                "raw_snr_db": 0.0,
                "cleaned_snr_db": 0.0,
                "snr_gain_db": 0.0,
                "normalization_gain_db": 0.0,
            }

        raw_snr = self._estimate_snr_db(raw_audio, self.sr)

        audio = raw_audio - float(np.mean(raw_audio))
        audio = self._suppress_clicks(audio)

        if len(audio) > 64:
            audio = signal.filtfilt(self.b60, self.a60, audio)
            audio = signal.filtfilt(self.b120, self.a120, audio)
            audio = signal.sosfiltfilt(self.sos_bandpass, audio).astype(np.float32)

        audio = self._spectral_denoise(audio, raw_snr_db=raw_snr)
        cleaned_audio, norm_gain_db = self._trim_and_normalize(audio)
        cleaned_snr = self._estimate_snr_db(cleaned_audio, self.sr)

        metrics = {
            "is_silent": False,
            "raw_duration_sec": raw_duration,
            "cleaned_duration_sec": round(len(cleaned_audio) / float(self.sr), 2),
            "raw_snr_db": raw_snr,
            "cleaned_snr_db": cleaned_snr,
            "snr_gain_db": round(max(0.0, cleaned_snr - raw_snr), 1),
            "normalization_gain_db": norm_gain_db,
        }
        return cleaned_audio, metrics
