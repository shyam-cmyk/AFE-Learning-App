const fs = require('node:fs');
const path = require('node:path');
const cpal = require('node-cpal');
const { LinearResampler, OnlineRecognizer } = require('sherpa-onnx-node');

console.log('======================================');
console.log('Sherpa ONNX Online STT Smoke Test');
console.log('======================================');

const modelDir = path.resolve(__dirname, '../../../packages/backend/stt-engine/sherpa-onnx-streaming-zipformer-indian-en');

const encoder = path.join(modelDir, 'encoder-epoch-10-avg-5-chunk-64-left-256.int8.onnx');
const decoder = path.join(modelDir, 'decoder-epoch-10-avg-5-chunk-64-left-256.int8.onnx');
const joiner = path.join(modelDir, 'joiner-epoch-10-avg-5-chunk-64-left-256.int8.onnx');
const tokens = path.join(modelDir, 'tokens.txt');

for (const [label, file] of [['encoder', encoder], ['decoder', decoder], ['joiner', joiner], ['tokens', tokens]]) {
  if (!fs.existsSync(file)) {
    console.error(`[smoke] missing ${label}: ${file}`);
    process.exit(1);
  }
}

const inputDevice = cpal.getDefaultInputDevice();
const inputConfig = cpal.getDefaultInputConfig(inputDevice.deviceId);
const inputSampleRate = inputConfig.sampleRate;
const resampler = new LinearResampler(inputSampleRate, 16000);

console.log('Microphone:', inputDevice);
console.log('Input config:', inputConfig);

const recognizer = new OnlineRecognizer({
  featConfig: {
    sampleRate: 16000,
    featureDim: 80,
  },

  modelConfig: {
    transducer: {
      encoder,
      decoder,
      joiner,
    },
    tokens,
    numThreads: 2,
    provider: 'cpu',
  },

  decodingMethod: 'greedy_search',
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 1.2,
  rule3MinUtteranceLength: 20,
});

console.log('[smoke] recognizer initialized');

const stream = recognizer.createStream();
let lastText = '';

function pcm16ToFloat32(buffer) {
  const src = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  const out = new Float32Array(src.length);

  for (let i = 0; i < src.length; i += 1) {
    out[i] = src[i] / 32768;
  }

  return out;
}

const micStream = cpal.createStream(
  inputDevice.deviceId,
  true,
  {
    sampleRate: inputConfig.sampleRate,
    channels: inputConfig.channels,
    format: 'f32',
  },
  (data) => {
    if (!data || data.length === 0) {
      return;
    }

    const samples = resampler.resample(data);
    stream.acceptWaveform({ samples, sampleRate: 16000 });

    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }

    const result = recognizer.getResult(stream);
    const text = (result && result.text ? result.text.trim() : '').trim();

    if (!text) {
      return;
    }

    const delta = text.startsWith(lastText)
      ? text.slice(lastText.length).trim()
      : text;

    if (delta) {
      console.log('[partial]', delta);
    }

    lastText = text;
  }
);

console.log('');
console.log('Listening for Hindi/Hinglish speech...');
console.log('Speak for about 10 seconds.');
console.log('');

setTimeout(() => {
  try {
    stream.inputFinished();
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }

    const finalResult = recognizer.getResult(stream);
    const finalText = finalResult && finalResult.text ? finalResult.text.trim() : '';

    console.log('[final]', finalText || '<no transcript>');
  } catch (error) {
    console.error('[smoke] finalization error:', error);
  } finally {
    console.log('[smoke] stopping microphone stream');
    process.exit(0);
  }
}, 10000);

console.log('Stream active:', cpal.isStreamActive(micStream));

function cleanup() {

  console.log("");
  console.log("Stopping microphone...");

  try {
    cpal.closeStream(micStream);
  } catch (e) {}

  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);