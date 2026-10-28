/**
 * Real-time Web Audio API DSP Noise Reduction & Voice Activity Detection (VAD) Pipeline.
 * 
 * Cleaning Process:
 * 1. Hardware-level constraints: echoCancellation, noiseSuppression, autoGainControl
 * 2. High-Pass BiquadFilter (85Hz, Q=0.7): Eliminates table bumps, low-frequency hum, air conditioner rumble
 * 3. Low-Pass BiquadFilter (7500Hz, Q=0.7): Cuts high-frequency electronic hiss & coil whine
 * 4. DynamicsCompressor: Normalizes speech dynamics (boosts quiet words, prevents clipping)
 * 5. AnalyserNode: Extracts speech band RMS energy (300Hz-3400Hz) for precise VAD silence detection
 * 6. MediaStreamDestination: Outputs cleaned audio stream directly into MediaRecorder
 */

export class AudioCleanerPipeline {
    constructor(options = {}) {
        this.options = {
            silenceTimeoutMs: options.silenceTimeoutMs || 2600, // Ms of silence to trigger end-of-speech
            speechThreshold: options.speechThreshold || 16,     // Minimum volume level (0-100) to mark speech start
            minSpeechDurationMs: options.minSpeechDurationMs || 800, // Minimum speech window before silence triggers
            onSpeechStart: options.onSpeechStart || (() => {}),
            onSpeechVolume: options.onSpeechVolume || (() => {}),
            onSilenceDetected: options.onSilenceDetected || (() => {}),
            ...options
        };

        this.audioContext = null;
        this.mediaStream = null;
        this.cleanStream = null;
        this.analyser = null;
        this.mediaRecorder = null;
        this.recorderMimeType = 'audio/webm';
        this.recordedChunks = [];
        this.activeDeviceLabel = '';

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
     * Initializes the microphone and builds the DSP audio filter graph.
     */
    async init() {
        if (this.mediaStream && this.cleanStream) return this.cleanStream;

        try {
            // 1. Request hardware microphone with configured device & native AEC + NS
            const savedDeviceId = this.options.deviceId || (typeof localStorage !== 'undefined' ? localStorage.getItem('valumni_selected_audio_device') : null);

            const baseAudioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
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

            // 2. Initialize Web Audio Context at hardware native sample rate to avoid double-resampling artifacts
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // 3. High-Pass Filter (85 Hz) - removes rumble & AC hum
            const highPass = this.audioContext.createBiquadFilter();
            highPass.type = 'highpass';
            highPass.frequency.setValueAtTime(85, this.audioContext.currentTime);
            highPass.Q.setValueAtTime(0.707, this.audioContext.currentTime);

            // 4. Low-Pass Filter (7500 Hz) - removes high-pitched hiss
            const lowPass = this.audioContext.createBiquadFilter();
            lowPass.type = 'lowpass';
            const nyquistSafeCutoff = Math.min(7500, Math.floor(this.audioContext.sampleRate * 0.45));
            lowPass.frequency.setValueAtTime(nyquistSafeCutoff, this.audioContext.currentTime);
            lowPass.Q.setValueAtTime(0.707, this.audioContext.currentTime);

            // 5. Dynamics Compressor - balances speech levels without over-amplifying room hiss
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.setValueAtTime(-24, this.audioContext.currentTime);
            compressor.knee.setValueAtTime(24, this.audioContext.currentTime);
            compressor.ratio.setValueAtTime(6, this.audioContext.currentTime);
            compressor.attack.setValueAtTime(0.005, this.audioContext.currentTime);
            compressor.release.setValueAtTime(0.25, this.audioContext.currentTime);

            // 6. Analyser Node for VAD & volume metering
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.smoothingTimeConstant = 0.35;

            // 7. Output destination stream for pristine MediaRecorder capture
            const destination = this.audioContext.createMediaStreamDestination();
            this.cleanStream = destination.stream;

            // Connect filter graph: Source -> HighPass -> LowPass -> Compressor -> Analyser & Destination
            source.connect(highPass);
            highPass.connect(lowPass);
            lowPass.connect(compressor);
            compressor.connect(this.analyser);
            compressor.connect(destination);

            return this.cleanStream;
        } catch (err) {
            console.error('AudioCleanerPipeline initialization error:', err);
            throw err;
        }
    }

    /**
     * Start listening and recording with active VAD silence detection.
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

        this.hasSpoken = false;
        this.isCurrentlySpeaking = false;
        this.activeSpeechFrames = 0;
        this.totalSpeechFrames = 0;
        this.listenStartTime = Date.now();
        this.speechStartTime = 0;
        this.silenceStartTime = 0;
        this.calibrationSamples = [];
        this.dynamicSpeechThreshold = this.options.speechThreshold || 16;
        this.recordedChunks = [];
        this.isProcessing = true;

        // Start MediaRecorder on the cleaned stream
        try {
            const preferredTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus'
            ];
            this.recorderMimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
            const recOptions = this.recorderMimeType ? { mimeType: this.recorderMimeType, audioBitsPerSecond: 64000 } : {};

            this.mediaRecorder = new MediaRecorder(this.cleanStream, recOptions);
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };
            this.mediaRecorder.start(200); // Collect audio chunks every 200ms
        } catch (e) {
            console.warn('MediaRecorder error on cleanStream:', e);
        }

        // Start VAD Loop
        this.runVadLoop();
    }

    /**
     * Returns true if sustained human speech was detected during this turn.
     */
    hasGenuineSpeech() {
        return this.hasSpoken && this.totalSpeechFrames >= 12;
    }

    /**
     * Continuous Voice Activity & Silence Detection loop.
     */
    runVadLoop() {
        if (!this.isProcessing || !this.analyser || !this.audioContext) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        // Compute exact FFT bins corresponding to human vocal band (300 Hz - 3400 Hz)
        const binHz = this.audioContext.sampleRate / this.analyser.fftSize;
        const startBin = Math.max(1, Math.floor(300 / binHz));
        const endBin = Math.min(bufferLength - 1, Math.ceil(3400 / binHz));

        let sum = 0;
        const binCount = Math.max(1, endBin - startBin + 1);
        for (let i = startBin; i <= endBin; i++) {
            sum += dataArray[i];
        }
        const avg = sum / binCount;
        const volume = Math.min(100, Math.round((avg / 128) * 100));

        this.options.onSpeechVolume(volume);

        const now = Date.now();

        // Ignore the first 350ms after TTS ends so speaker echo / room tail never false-triggers VAD
        if (now - this.listenStartTime < 350) {
            this.animFrameId = requestAnimationFrame(() => this.runVadLoop());
            return;
        }

        // Calibrate ambient noise floor over the initial ~20 quiet frames (~330ms)
        if (!this.hasSpoken && this.calibrationSamples.length < 20 && volume < 35) {
            this.calibrationSamples.push(volume);
            const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
            const medianFloor = sorted[Math.floor(sorted.length / 2)] || 0;
            this.dynamicSpeechThreshold = Math.max(this.options.speechThreshold || 16, medianFloor + 10);
        }

        const speechThreshold = this.dynamicSpeechThreshold || this.options.speechThreshold || 16;

        // 1. Detect Active Speech (require sustained consecutive frames to reject clicks/breaths)
        if (volume >= speechThreshold) {
            this.isCurrentlySpeaking = true;
            this.activeSpeechFrames += 1;
            this.totalSpeechFrames += 1;

            // Require ~170ms (10 frames at 60fps) of sustained voice energy before marking speech started
            if (this.activeSpeechFrames >= 10 && !this.hasSpoken) {
                this.hasSpoken = true;
                this.speechStartTime = now;
                this.silenceStartTime = 0;
                this.options.onSpeechStart();
            }

            // Reset silence timer whenever genuine vocal energy resumes (~80ms+)
            if (this.hasSpoken && this.activeSpeechFrames >= 5) {
                this.silenceStartTime = 0;
            }
        } else {
            this.isCurrentlySpeaking = false;
            this.activeSpeechFrames = 0;

            // 2. Track Silence once user has genuinely spoken
            if (this.hasSpoken && this.totalSpeechFrames >= 16) {
                const speechDuration = now - this.speechStartTime;

                if (speechDuration >= (this.options.minSpeechDurationMs || 800)) {
                    if (!this.silenceStartTime) {
                        this.silenceStartTime = now;
                    } else if (now - this.silenceStartTime >= (this.options.silenceTimeoutMs || 2600)) {
                        // User has finished their response!
                        this.isProcessing = false;
                        this.options.onSilenceDetected();
                        return;
                    }
                }
            }
        }

        this.animFrameId = requestAnimationFrame(() => this.runVadLoop());
    }

    /**
     * Stop listening, cancel VAD loop, and return the cleaned audio blob.
     */
    async stopListening() {
        this.isProcessing = false;
        this.isCurrentlySpeaking = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this.options.onSpeechVolume(0);

        const blobType = this.recorderMimeType || 'audio/webm';

        return new Promise((resolve) => {
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
    }

    /**
     * Clean up all audio nodes and release microphone.
     */
    destroy() {
        this.isProcessing = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
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
