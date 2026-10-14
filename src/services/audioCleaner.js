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
            silenceTimeoutMs: options.silenceTimeoutMs || 2200, // Ms of silence to trigger end-of-speech
            speechThreshold: options.speechThreshold || 12,     // Volume level (0-100) to mark speech start
            minSpeechDurationMs: options.minSpeechDurationMs || 600, // Minimum speech needed before silence triggers
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
        this.recordedChunks = [];

        this.hasSpoken = false;
        this.speechStartTime = 0;
        this.silenceStartTime = 0;
        this.isProcessing = false;
        this.animFrameId = null;
    }

    /**
     * Initializes the microphone and builds the DSP audio filter graph.
     */
    async init() {
        if (this.mediaStream) return this.mediaStream;

        try {
            // 1. Request hardware microphone with aggressive native AEC + NS
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            });

            // 2. Initialize Web Audio Context
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass({ sampleRate: 16000 });

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
            lowPass.frequency.setValueAtTime(7500, this.audioContext.currentTime);
            lowPass.Q.setValueAtTime(0.707, this.audioContext.currentTime);

            // 5. Dynamics Compressor - balances speech levels
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.setValueAtTime(-24, this.audioContext.currentTime);
            compressor.knee.setValueAtTime(30, this.audioContext.currentTime);
            compressor.ratio.setValueAtTime(12, this.audioContext.currentTime);
            compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
            compressor.release.setValueAtTime(0.25, this.audioContext.currentTime);

            // 6. Analyser Node for VAD & volume metering
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.4;

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
    startListening() {
        if (!this.cleanStream) return;

        this.hasSpoken = false;
        this.speechStartTime = 0;
        this.silenceStartTime = 0;
        this.recordedChunks = [];
        this.isProcessing = true;

        // Start MediaRecorder on the cleaned stream
        try {
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.mediaRecorder = new MediaRecorder(this.cleanStream, { mimeType });
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };
            this.mediaRecorder.start(250); // Collect data chunks every 250ms
        } catch (e) {
            console.warn('MediaRecorder error on cleanStream:', e);
        }

        // Start VAD Loop
        this.runVadLoop();
    }

    /**
     * Continuous Voice Activity & Silence Detection loop.
     */
    runVadLoop() {
        if (!this.isProcessing || !this.analyser) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        // Calculate speech band energy (approx bins 5 to 55 for ~300Hz - 3400Hz speech)
        let sum = 0;
        const startBin = 5;
        const endBin = Math.min(bufferLength, 55);
        for (let i = startBin; i < endBin; i++) {
            sum += dataArray[i];
        }
        const avg = sum / (endBin - startBin);
        const volume = Math.min(100, Math.round((avg / 128) * 100));

        this.options.onSpeechVolume(volume);

        const now = Date.now();

        // Dynamically track ambient background noise floor during initial frames
        if (!this.calibrationCount) this.calibrationCount = 0;
        if (this.calibrationCount < 25) {
            this.calibrationCount++;
            this.ambientFloor = Math.min(this.ambientFloor || 100, volume);
            this.dynamicSpeechThreshold = Math.max(10, (this.ambientFloor || 8) + 6);
            this.dynamicSilenceThreshold = Math.max(5, (this.ambientFloor || 8) + 2);
        }

        // Track speech threshold with soft floor
        const speechThreshold = this.dynamicSpeechThreshold || this.options.speechThreshold || 8;
        const silenceThreshold = Math.max(3, speechThreshold - 2);

        // 1. Detect Active Speech (with consecutive frame debouncing)
        if (volume >= speechThreshold) {
            this.activeSpeechFrames = (this.activeSpeechFrames || 0) + 1;
            
            // Require at least 2 frames of voice to confirm genuine user speech
            if (this.activeSpeechFrames >= 2) {
                if (!this.hasSpoken) {
                    this.hasSpoken = true;
                    this.speechStartTime = now;
                    this.options.onSpeechStart();
                }
                // Only reset silence timer if user speaks consecutively for >120ms (prevents single-click resets)
                if (this.activeSpeechFrames >= 7) {
                    this.silenceStartTime = 0;
                }
            }
        } else {
            this.activeSpeechFrames = 0;

            // 2. Track Silence once user has spoken
            if (this.hasSpoken) {
                const speechDuration = now - this.speechStartTime;

                if (speechDuration >= (this.options.minSpeechDurationMs || 400)) {
                    if (!this.silenceStartTime) {
                        this.silenceStartTime = now;
                    } else if (now - this.silenceStartTime >= (this.options.silenceTimeoutMs || 1800)) {
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
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }

        return new Promise((resolve) => {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                    this.recordedChunks = [];
                    resolve(blob);
                };
                this.mediaRecorder.stop();
            } else {
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
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
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
