/**
 * Studio-Grade Real-Time Web Audio DSP Voice Cleaner & Lossless 16 kHz WAV Capture Pipeline.
 *
 * Works in tandem with the Python server-side VoiceCleaner + faster-whisper Large-v3-Turbo:
 * 1. Hardware-level constraints: echoCancellation, noiseSuppression, autoGainControl, mono capture
 * 2. High-Pass Butterworth Filter (80 Hz, Q=0.707): Removes mic bumps, wind pops, & fan rumble
 * 3. 60 Hz & 120 Hz Notch Filters (Q=12): Surgically removes Philippine AC mains power hum
 * 4. Low-Mid Mud Cut (220 Hz, -2.5 dB): Clears boxy desk/room reflections masking F1 formants
 * 5. Consonant & Sibilant Presence Boost (2850 Hz, +2.5 dB): Sharpens t/k/p/s/c/f/h articulation
 * 6. Anti-Hiss Low-Pass Filter (7800 Hz, Q=0.707): Clean Nyquist ceiling for 16 kHz Whisper ASR
 * 7. Transparent Peak Limiter (-8 dB, 2.5:1): Prevents clipping without pumping room noise
 * 8. 600 ms Pre-Speech Ring Buffer + Lossless 16 kHz 16-bit Mono PCM WAV Encoder:
 *    Eliminates lossy 64kbps Opus sibilant smearing and preserves soft initial consonants.
 */

const TARGET_WHISPER_SAMPLE_RATE = 16000;

/**
 * Resamples mono Float32 PCM audio to 16,000 Hz using browser C++ OfflineAudioContext
 * (with anti-aliased linear interpolation fallback) and encodes a 16-bit PCM RIFF WAV Blob.
 */
export async function encodeFloat32ToWav16k(samples, sourceSampleRate) {
    if (!samples || samples.length === 0) {
        return new Blob([], { type: 'audio/wav' });
    }

    let resampled = samples;
    const targetLength = Math.max(1, Math.round((samples.length * TARGET_WHISPER_SAMPLE_RATE) / sourceSampleRate));

    if (sourceSampleRate !== TARGET_WHISPER_SAMPLE_RATE) {
        const OfflineCtx = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
        if (OfflineCtx) {
            try {
                const offlineCtx = new OfflineCtx(1, targetLength, TARGET_WHISPER_SAMPLE_RATE);
                const audioBuf = offlineCtx.createBuffer(1, samples.length, sourceSampleRate);
                audioBuf.copyToChannel(samples, 0);
                const bufSource = offlineCtx.createBufferSource();
                bufSource.buffer = audioBuf;
                bufSource.connect(offlineCtx.destination);
                bufSource.start(0);
                const rendered = await offlineCtx.startRendering();
                resampled = rendered.getChannelData(0);
            } catch (e) {
                resampled = linearResample(samples, sourceSampleRate, TARGET_WHISPER_SAMPLE_RATE);
            }
        } else {
            resampled = linearResample(samples, sourceSampleRate, TARGET_WHISPER_SAMPLE_RATE);
        }
    }

    // Encode standard 44-byte RIFF WAVE header + 16-bit signed little-endian PCM payload
    const numSamples = resampled.length;
    const dataBytes = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // AudioFormat = 1 (Linear PCM)
    view.setUint16(22, 1, true);  // NumChannels = 1 (Mono)
    view.setUint32(24, TARGET_WHISPER_SAMPLE_RATE, true);
    view.setUint32(28, TARGET_WHISPER_SAMPLE_RATE * 2, true); // ByteRate
    view.setUint16(32, 2, true);  // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample = 16
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const clamped = Math.max(-1, Math.min(1, resampled[i]));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

function linearResample(input, srcRate, dstRate) {
    const outLength = Math.max(1, Math.round((input.length * dstRate) / srcRate));
    const output = new Float32Array(outLength);
    const ratio = (input.length - 1) / Math.max(1, outLength - 1);
    for (let i = 0; i < outLength; i++) {
        const pos = i * ratio;
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const s0 = input[idx] || 0;
        const s1 = input[Math.min(idx + 1, input.length - 1)] || 0;
        output[i] = s0 + frac * (s1 - s0);
    }
    return output;
}

export class AudioCleanerPipeline {
    constructor(options = {}) {
        this.options = {
            silenceTimeoutMs: options.silenceTimeoutMs || 1550,
            longTurnSilenceTimeoutMs: options.longTurnSilenceTimeoutMs || 1950,
            speechThreshold: options.speechThreshold || 15,
            minSpeechDurationMs: options.minSpeechDurationMs || 650,
            preRollMs: options.preRollMs || 600,
            tailPadMs: options.tailPadMs || 500,
            chunkMinDurationSec: options.chunkMinDurationSec || 7.5,
            chunkSilenceSplitMs: options.chunkSilenceSplitMs || 520,
            onSpeechStart: options.onSpeechStart || (() => {}),
            onSpeechVolume: options.onSpeechVolume || (() => {}),
            onSpeechChunk: options.onSpeechChunk || null,
            onSilenceDetected: options.onSilenceDetected || (() => {}),
            ...options
        };

        this.audioContext = null;
        this.mediaStream = null;
        this.cleanStream = null;
        this.analyser = null;
        this.pcmProcessor = null;
        this.silentSink = null;
        this.mediaRecorder = null;
        this.recorderMimeType = 'audio/webm';
        this.recordedChunks = [];
        this.activeDeviceLabel = '';

        // Lossless PCM capture & breath-aligned background chunk streaming state
        this.preRollChunks = [];
        this.preRollSampleCount = 0;
        this.pcmChunks = [];
        this.pcmSampleCount = 0;
        this.lastVoicedChunkIndex = -1;
        this.hasVoicedInCurrentSegment = false;
        this.voicedFramesInCurrentSegment = 0;
        this.segmentChunkIndex = 0;
        this.activeFlushPromise = null;
        this.listenSessionId = 0;

        this.hasSpoken = false;
        this.isCurrentlySpeaking = false;
        this.activeSpeechFrames = 0;
        this.totalSpeechFrames = 0;
        this.listenStartTime = 0;
        this.speechStartTime = 0;
        this.silenceStartTime = 0;
        this.calibrationSamples = [];
        this.dynamicSpeechThreshold = this.options.speechThreshold;
        this.isProcessing = false;
        this.animFrameId = null;
    }

    /**
     * Initializes the microphone and builds the 7-stage Web Audio DSP filter graph.
     */
    async init() {
        if (this.mediaStream && this.cleanStream) return this.cleanStream;

        try {
            const savedDeviceId =
                this.options.deviceId ||
                (typeof localStorage !== 'undefined' ? localStorage.getItem('valumni_selected_audio_device') : null);

            const baseAudioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: { ideal: 48000 }
            };

            try {
                const preferredConstraints = savedDeviceId
                    ? { ...baseAudioConstraints, deviceId: { exact: savedDeviceId } }
                    : baseAudioConstraints;
                this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: preferredConstraints });
            } catch (deviceErr) {
                console.warn('Selected audio device unavailable, falling back to system default:', deviceErr);
                this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: baseAudioConstraints });
            }

            const track = this.mediaStream.getAudioTracks()[0];
            this.activeDeviceLabel = track?.label || '';

            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const now = this.audioContext.currentTime;
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // 1. Sub-Bass & Plosive Wind-Pop High-Pass (80 Hz Butterworth)
            const highPass = this.audioContext.createBiquadFilter();
            highPass.type = 'highpass';
            highPass.frequency.setValueAtTime(80, now);
            highPass.Q.setValueAtTime(0.707, now);

            // 2. Philippine 60 Hz & 120 Hz Mains Hum Notch Filters
            const notch60 = this.audioContext.createBiquadFilter();
            notch60.type = 'notch';
            notch60.frequency.setValueAtTime(60, now);
            notch60.Q.setValueAtTime(12.0, now);

            const notch120 = this.audioContext.createBiquadFilter();
            notch120.type = 'notch';
            notch120.frequency.setValueAtTime(120, now);
            notch120.Q.setValueAtTime(12.0, now);

            // 3. Low-Mid Desk/Room Boxiness Cut (220 Hz, -2.5 dB)
            const mudCut = this.audioContext.createBiquadFilter();
            mudCut.type = 'peaking';
            mudCut.frequency.setValueAtTime(220, now);
            mudCut.Q.setValueAtTime(1.1, now);
            mudCut.gain.setValueAtTime(-2.5, now);

            // 4. Vocal Formant & Consonant Articulation Presence Boost (2850 Hz, +2.5 dB)
            const presenceBoost = this.audioContext.createBiquadFilter();
            presenceBoost.type = 'peaking';
            presenceBoost.frequency.setValueAtTime(2850, now);
            presenceBoost.Q.setValueAtTime(0.85, now);
            presenceBoost.gain.setValueAtTime(2.5, now);

            // 5. Anti-Hiss Low-Pass Filter (7800 Hz ceiling for 16 kHz Whisper Nyquist)
            const lowPass = this.audioContext.createBiquadFilter();
            lowPass.type = 'lowpass';
            const nyquistSafeCutoff = Math.min(7800, Math.floor(this.audioContext.sampleRate * 0.45));
            lowPass.frequency.setValueAtTime(nyquistSafeCutoff, now);
            lowPass.Q.setValueAtTime(0.707, now);

            // 6. Gentle Transparent Peak Limiter (prevents clipping without pumping background hiss)
            const limiter = this.audioContext.createDynamicsCompressor();
            limiter.threshold.setValueAtTime(-8, now);
            limiter.knee.setValueAtTime(10, now);
            limiter.ratio.setValueAtTime(2.5, now);
            limiter.attack.setValueAtTime(0.003, now);
            limiter.release.setValueAtTime(0.15, now);

            // 7. Analyser Node for VAD & live volume metering
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.smoothingTimeConstant = 0.3;

            // 8. Lossless PCM Capture Tap (2048 samples/frame connected to muted sink)
            if (this.audioContext.createScriptProcessor) {
                this.pcmProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
                this.silentSink = this.audioContext.createGain();
                this.silentSink.gain.setValueAtTime(0, now);

                this.pcmProcessor.onaudioprocess = (event) => {
                    if (!this.isProcessing) return;
                    // Ignore the first 300ms post-TTS echo guard window
                    if (Date.now() - this.listenStartTime < 300) return;

                    const inputData = event.inputBuffer.getChannelData(0);
                    const chunkCopy = new Float32Array(inputData.length);
                    chunkCopy.set(inputData);

                    const maxTotalSamples = this.audioContext.sampleRate * 600; // 10 min cap for extended long-form answers

                    if (!this.hasSpoken) {
                        const maxPreRollSamples = Math.ceil((this.options.preRollMs / 1000) * this.audioContext.sampleRate);
                        this.preRollChunks.push(chunkCopy);
                        this.preRollSampleCount += chunkCopy.length;
                        while (this.preRollSampleCount > maxPreRollSamples && this.preRollChunks.length > 1) {
                            const dropped = this.preRollChunks.shift();
                            this.preRollSampleCount -= dropped.length;
                        }
                    } else if (this.pcmSampleCount < maxTotalSamples) {
                        this.pcmChunks.push(chunkCopy);
                        this.pcmSampleCount += chunkCopy.length;
                        if (this.isCurrentlySpeaking) {
                            this.lastVoicedChunkIndex = this.pcmChunks.length - 1;
                        }
                    }
                };
            }

            // 9. Cleaned MediaStreamDestination (fallback MediaRecorder stream)
            const destination = this.audioContext.createMediaStreamDestination();
            this.cleanStream = destination.stream;

            // Wire DSP chain:
            // source -> highPass -> notch60 -> notch120 -> mudCut -> presenceBoost -> lowPass -> limiter
            source.connect(highPass);
            highPass.connect(notch60);
            notch60.connect(notch120);
            notch120.connect(mudCut);
            mudCut.connect(presenceBoost);
            presenceBoost.connect(lowPass);
            lowPass.connect(limiter);

            limiter.connect(this.analyser);
            limiter.connect(destination);
            if (this.pcmProcessor && this.silentSink) {
                limiter.connect(this.pcmProcessor);
                this.pcmProcessor.connect(this.silentSink);
                this.silentSink.connect(this.audioContext.destination);
            }

            return this.cleanStream;
        } catch (err) {
            console.error('AudioCleanerPipeline initialization error:', err);
            throw err;
        }
    }

    /**
     * Start listening and capturing cleaned lossless PCM + VAD silence detection.
     */
    async startListening() {
        if (!this.cleanStream) {
            try {
                await this.init();
            } catch (e) {
                return;
            }
        }
        if (!this.cleanStream) return;

        if (this.audioContext && this.audioContext.state === 'suspended') {
            try { await this.audioContext.resume(); } catch (e) {}
        }

        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try { this.mediaRecorder.stop(); } catch (e) {}
        }

        this.listenSessionId += 1;
        this.hasSpoken = false;
        this.isCurrentlySpeaking = false;
        this.activeSpeechFrames = 0;
        this.totalSpeechFrames = 0;
        this.listenStartTime = Date.now();
        this.speechStartTime = 0;
        this.silenceStartTime = 0;
        this.calibrationSamples = [];
        this.dynamicSpeechThreshold = this.options.speechThreshold || 15;

        this.preRollChunks = [];
        this.preRollSampleCount = 0;
        this.pcmChunks = [];
        this.pcmSampleCount = 0;
        this.lastVoicedChunkIndex = -1;
        this.hasVoicedInCurrentSegment = false;
        this.voicedFramesInCurrentSegment = 0;
        this.segmentChunkIndex = 0;
        this.activeFlushPromise = null;
        this.recordedChunks = [];
        this.isProcessing = true;

        // Keep high-bitrate MediaRecorder running in parallel as a secondary fallback
        try {
            const preferredTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus'
            ];
            this.recorderMimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
            const recOptions = this.recorderMimeType
                ? { mimeType: this.recorderMimeType, audioBitsPerSecond: 96000 }
                : {};

            this.mediaRecorder = new MediaRecorder(this.cleanStream, recOptions);
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };
            this.mediaRecorder.start(200);
        } catch (e) {
            console.warn('MediaRecorder fallback note:', e);
        }

        this.runVadLoop();
    }

    /**
     * Returns true if sustained human speech was detected during this turn.
     */
    hasGenuineSpeech() {
        return this.hasSpoken && this.totalSpeechFrames >= 10;
    }

    /**
     * Continuous Voice Activity & Silence Detection loop over human vocal frequencies (250 Hz - 3800 Hz).
     */
    runVadLoop() {
        if (!this.isProcessing || !this.analyser || !this.audioContext) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        const binHz = this.audioContext.sampleRate / this.analyser.fftSize;
        const startBin = Math.max(1, Math.floor(250 / binHz));
        const endBin = Math.min(bufferLength - 1, Math.ceil(3800 / binHz));

        let sum = 0;
        const binCount = Math.max(1, endBin - startBin + 1);
        for (let i = startBin; i <= endBin; i++) {
            sum += dataArray[i];
        }
        const avg = sum / binCount;
        const volume = Math.min(100, Math.round((avg / 128) * 100));

        this.options.onSpeechVolume(volume);

        const now = Date.now();

        // Post-TTS room reflection guard (320 ms)
        if (now - this.listenStartTime < 320) {
            this.animFrameId = requestAnimationFrame(() => this.runVadLoop());
            return;
        }

        // Dynamic ambient noise-floor calibration over initial quiet frames
        if (!this.hasSpoken && this.calibrationSamples.length < 20 && volume < 35) {
            this.calibrationSamples.push(volume);
            const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
            const medianFloor = sorted[Math.floor(sorted.length / 2)] || 0;
            this.dynamicSpeechThreshold = Math.max(this.options.speechThreshold || 15, medianFloor + 9);
        }

        const speechThreshold = this.dynamicSpeechThreshold || this.options.speechThreshold || 15;

        if (volume >= speechThreshold) {
            this.isCurrentlySpeaking = true;
            this.activeSpeechFrames += 1;
            this.totalSpeechFrames += 1;

            // Require ~150ms (9 frames) of sustained vocal energy to confirm speech start
            if (this.activeSpeechFrames >= 9 && !this.hasSpoken) {
                this.hasSpoken = true;
                this.speechStartTime = now;
                this.silenceStartTime = 0;
                this.hasVoicedInCurrentSegment = true;
                this.voicedFramesInCurrentSegment = this.activeSpeechFrames;

                // Flush 600ms pre-speech ring buffer into active PCM recording so initial consonants are preserved!
                if (this.preRollChunks.length > 0) {
                    this.pcmChunks = [...this.preRollChunks, ...this.pcmChunks];
                    this.pcmSampleCount += this.preRollSampleCount;
                    this.lastVoicedChunkIndex = Math.max(0, this.pcmChunks.length - 1);
                    this.preRollChunks = [];
                    this.preRollSampleCount = 0;
                }

                this.options.onSpeechStart();
            } else if (this.hasSpoken) {
                this.hasVoicedInCurrentSegment = true;
                this.voicedFramesInCurrentSegment += 1;
            }

            if (this.hasSpoken && this.activeSpeechFrames >= 4) {
                this.silenceStartTime = 0;
            }
        } else {
            this.isCurrentlySpeaking = false;
            this.activeSpeechFrames = 0;

            if (this.hasSpoken && this.totalSpeechFrames >= 12) {
                const speechDuration = now - this.speechStartTime;

                if (speechDuration >= (this.options.minSpeechDurationMs || 650)) {
                    // Adaptive VAD: fast 1.55s cutoff for concise turns; 1.95s breathing room for multi-sentence long answers
                    const adaptiveSilenceMs = speechDuration >= 4500
                        ? (this.options.longTurnSilenceTimeoutMs || 1950)
                        : (this.options.silenceTimeoutMs || 1550);

                    if (!this.silenceStartTime) {
                        this.silenceStartTime = now;
                    } else {
                        const silenceElapsed = now - this.silenceStartTime;
                        const segDurationSec = this.pcmSampleCount / this.audioContext.sampleRate;

                        // Breath-aligned background streaming: flush completed >=7.5s speech chunks on >=520ms breath pauses
                        // so Office CPUs transcribe long answers incrementally while the user is still speaking!
                        if (
                            typeof this.options.onSpeechChunk === 'function' &&
                            this.hasVoicedInCurrentSegment &&
                            this.voicedFramesInCurrentSegment >= 16 &&
                            segDurationSec >= (this.options.chunkMinDurationSec || 7.5) &&
                            silenceElapsed >= (this.options.chunkSilenceSplitMs || 520) &&
                            !this.activeFlushPromise
                        ) {
                            this._flushCurrentSegmentChunk();
                        }

                        if (silenceElapsed >= adaptiveSilenceMs) {
                            this.isProcessing = false;
                            this.options.onSilenceDetected();
                            return;
                        }
                    }
                }
            }
        }

        this.animFrameId = requestAnimationFrame(() => this.runVadLoop());
    }

    /**
     * Slices and encodes the current completed speech segment during a natural >=520ms breath pause
     * so the server begins transcribing in the background while recording continues seamlessly.
     */
    _flushCurrentSegmentChunk() {
        if (this.activeFlushPromise || !this.audioContext || this.pcmChunks.length === 0) return;

        const sr = this.audioContext.sampleRate;
        const sessionAtStart = this.listenSessionId;
        const chunkIdx = this.segmentChunkIndex;
        this.segmentChunkIndex += 1;

        // Keep ~180ms of quiet breath frames as pre-roll cushion in case the interviewee continues speaking
        const keepFrames = Math.min(
            Math.max(1, Math.ceil((0.18 * sr) / 2048)),
            Math.max(0, this.pcmChunks.length - 1)
        );
        const chunksToEncode = this.pcmChunks.slice();
        const keptTail = keepFrames > 0 ? this.pcmChunks.slice(-keepFrames) : [];

        this.pcmChunks = keptTail;
        this.pcmSampleCount = keptTail.reduce((acc, c) => acc + c.length, 0);
        this.lastVoicedChunkIndex = -1;
        this.hasVoicedInCurrentSegment = false;
        this.voicedFramesInCurrentSegment = 0;

        let totalSamples = 0;
        for (let i = 0; i < chunksToEncode.length; i++) {
            totalSamples += chunksToEncode[i].length;
        }
        const merged = new Float32Array(totalSamples);
        let offset = 0;
        for (let i = 0; i < chunksToEncode.length; i++) {
            merged.set(chunksToEncode[i], offset);
            offset += chunksToEncode[i].length;
        }

        this.activeFlushPromise = encodeFloat32ToWav16k(merged, sr)
            .then((wavBlob) => {
                if (this.listenSessionId === sessionAtStart && wavBlob && wavBlob.size > 1200) {
                    this.options.onSpeechChunk?.(wavBlob, chunkIdx);
                }
            })
            .catch((err) => {
                console.warn('Background speech chunk encode note:', err);
            })
            .finally(() => {
                this.activeFlushPromise = null;
            });
    }

    /**
     * Stops listening and returns the remaining lossless 16 kHz PCM WAV tail (or null if 100% of speech
     * was already flushed during breath pauses, or compact Opus WebM for non-chunked >20s turns).
     */
    async stopListening() {
        this.isProcessing = false;
        this.isCurrentlySpeaking = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this.options.onSpeechVolume(0);

        if (this.activeFlushPromise) {
            try {
                await this.activeFlushPromise;
            } catch (e) {}
        }

        const hadPriorFlushedChunks = this.segmentChunkIndex > 0;

        // Stop parallel fallback MediaRecorder cleanly
        const webmFallbackBlob = await new Promise((resolve) => {
            const blobType = this.recorderMimeType || 'audio/webm';
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.recordedChunks, { type: blobType });
                    this.recordedChunks = [];
                    resolve(blob);
                };
                try {
                    if (this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.requestData();
                    }
                    this.mediaRecorder.stop();
                } catch (e) {
                    const blob = new Blob(this.recordedChunks, { type: blobType });
                    this.recordedChunks = [];
                    resolve(blob);
                }
            } else {
                const blob = new Blob(this.recordedChunks, { type: blobType });
                this.recordedChunks = [];
                resolve(blob);
            }
        });

        // If prior chunks were already flushed during breath pauses and no new speech occurred afterward, nothing remains to upload!
        if (hadPriorFlushedChunks && (!this.hasVoicedInCurrentSegment || this.voicedFramesInCurrentSegment < 6)) {
            this.pcmChunks = [];
            this.pcmSampleCount = 0;
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            return null;
        }

        // Build lossless 16kHz 16-bit PCM WAV from captured DSP buffers (or use compact Opus WebM for unchunked >20s turns)
        const activeChunks = this.pcmChunks.length > 0 ? this.pcmChunks : this.preRollChunks;
        if (activeChunks.length > 0 && this.audioContext) {
            try {
                const sr = this.audioContext.sampleRate;
                let endChunkIdx = activeChunks.length;

                // Trim excess trailing silence beyond tailPadMs (500ms)
                if (this.pcmChunks.length > 0 && this.lastVoicedChunkIndex >= 0) {
                    const padChunks = Math.ceil(((this.options.tailPadMs || 500) / 1000) * sr / 2048);
                    endChunkIdx = Math.min(activeChunks.length, this.lastVoicedChunkIndex + 1 + padChunks);
                }

                let totalSamples = 0;
                for (let i = 0; i < endChunkIdx; i++) {
                    totalSamples += activeChunks[i].length;
                }

                const durationSec = totalSamples / sr;

                // Only use full-turn WebM when no mid-turn chunks were flushed (avoids duplicating already-transcribed segments)
                if (!hadPriorFlushedChunks && durationSec > 20 && webmFallbackBlob && webmFallbackBlob.size > 2000) {
                    this.pcmChunks = [];
                    this.pcmSampleCount = 0;
                    this.preRollChunks = [];
                    this.preRollSampleCount = 0;
                    return webmFallbackBlob;
                }

                if (totalSamples > Math.floor(sr * 0.2)) {
                    const merged = new Float32Array(totalSamples);
                    let offset = 0;
                    for (let i = 0; i < endChunkIdx; i++) {
                        merged.set(activeChunks[i], offset);
                        offset += activeChunks[i].length;
                    }

                    this.pcmChunks = [];
                    this.pcmSampleCount = 0;
                    this.preRollChunks = [];
                    this.preRollSampleCount = 0;

                    const wavBlob = await encodeFloat32ToWav16k(merged, sr);
                    if (wavBlob && wavBlob.size > 1000) {
                        return wavBlob;
                    }
                }
            } catch (wavErr) {
                console.warn('WAV encoding fallback to WebM:', wavErr);
            }
        }

        this.pcmChunks = [];
        this.pcmSampleCount = 0;
        this.preRollChunks = [];
        this.preRollSampleCount = 0;
        return hadPriorFlushedChunks ? null : webmFallbackBlob;
    }

    /**
     * Clean up all audio nodes and release microphone hardware.
     */
    destroy() {
        this.isProcessing = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this.pcmProcessor) {
            try {
                this.pcmProcessor.onaudioprocess = null;
                this.pcmProcessor.disconnect();
            } catch (e) {}
            this.pcmProcessor = null;
        }
        if (this.silentSink) {
            try { this.silentSink.disconnect(); } catch (e) {}
            this.silentSink = null;
        }
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try { this.mediaRecorder.stop(); } catch (e) {}
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }
        this.cleanStream = null;
    }
}
