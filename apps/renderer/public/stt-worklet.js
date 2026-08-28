/**
 * Audio Worklet for STT: downsamples to 16 kHz mono, converts to Int16,
 * and performs Voice Activity Detection (VAD).
 * Runs on the audio thread (replaces deprecated ScriptProcessorNode).
 */
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) return buffer;
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function convertFloat32ToInt16(buffer) {
  const l = buffer.length;
  const result = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return result;
}

/**
 * Compute RMS energy of a Float32Array audio frame.
 */
function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

class SttProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sampleRate = options.processorOptions?.sampleRate ?? 48000;

    // VAD is intentionally off for tap-to-talk mode so the mic stays live until
    // the user explicitly stops recording. Auto-stopping on silence cuts off
    // normal speech and prevents reliable transcription.
    this.vadEnabled = options.processorOptions?.vadEnabled ?? false;
    this.silenceThreshold = options.processorOptions?.silenceThreshold ?? 0.04;
    this.silenceDuration = options.processorOptions?.silenceDuration ?? 3.2;
    this.minSpeechDuration = options.processorOptions?.minSpeechDuration ?? 0.8;

    // VAD state
    this.silentFrameCount = 0;
    this.speechFrameCount = 0;
    this.speechDetected = false;
    this.silenceTriggered = false;
    // Each process() call handles 128 samples at the input sample rate
    // Calculate how many frames equal the silence duration
    this.framesPerSecond = this.sampleRate / 128;
    this.silenceFrameThreshold = Math.round(this.silenceDuration * this.framesPerSecond);
    this.minSpeechFrameThreshold = Math.round(this.minSpeechDuration * this.framesPerSecond);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    // Compute RMS for VAD and audio level visualization
    const rms = computeRMS(input);

    // Always send audio level for orb animation
    this.port.postMessage({ type: "audio-level", level: Math.min(1, rms * 10) });

    // Downsample and convert for STT
    const downsampled = downsampleBuffer(input, this.sampleRate, 16000);
    const int16 = convertFloat32ToInt16(downsampled);
    this.port.postMessage({ type: "audio-data", buffer: int16.buffer }, [int16.buffer]);

    // VAD logic (only when enabled)
    if (this.vadEnabled) {
      if (rms > this.silenceThreshold) {
        // Sound above threshold
        this.silentFrameCount = 0;
        this.speechFrameCount++;
        // Only count as real speech after sustained audio above threshold
        if (!this.speechDetected && this.speechFrameCount >= this.minSpeechFrameThreshold) {
          this.speechDetected = true;
          this.silenceTriggered = false;
          this.port.postMessage({ type: "vad-speech" });
        }
      } else {
        // Silence
        this.silentFrameCount++;
        // If we hadn't confirmed speech yet, reset the speech frame counter
        if (!this.speechDetected) {
          this.speechFrameCount = 0;
        }
        if (
          this.speechDetected &&
          !this.silenceTriggered &&
          this.silentFrameCount >= this.silenceFrameThreshold
        ) {
          this.silenceTriggered = true;
          // Reset for next round
          this.speechDetected = false;
          this.speechFrameCount = 0;
          this.port.postMessage({ type: "vad-silence" });
        }
      }
    }

    return true;
  }
}

registerProcessor("stt-processor", SttProcessor);
