const sherpa = require('sherpa-onnx-node');
const cpal = require('node-cpal');

const MODEL_DIR = './models';

console.log('Loading Hinglish model...');

const recognizer = new sherpa.OfflineRecognizer({
  featConfig: {
    sampleRate: 16000,
    featureDim: 80,
  },

  modelConfig: {
    transducer: {},
    paraformer: {},
    zipformer: {},
    nemoCtc: {},

    whisper: {
      encoder: `${MODEL_DIR}/encoder.int8.onnx`,
      decoder: `${MODEL_DIR}/decoder.int8.onnx`,
    },

    tokens: `${MODEL_DIR}/hinglish-tokens.txt`,
    numThreads: 4,
    provider: 'cpu',
    debug: 0,
  },

  decodingMethod: 'greedy_search',
});

console.log('Hinglish model loaded.');

const inputDevice = cpal.getDefaultInputDevice();

console.log('Microphone:', inputDevice);

const inputConfig = cpal.getDefaultInputConfig(inputDevice.deviceId);

console.log('Input config:', inputConfig);

const resampler = new sherpa.LinearResampler(
  inputConfig.sampleRate,
  16000
);

const recognitionStream = recognizer.createStream();

let audioChunks = [];
let totalSamples = 0;

const stream = cpal.createStream(
  inputDevice.deviceId,
  true,
  {
    sampleRate: inputConfig.sampleRate,
    channels: 1,
    format: 'f32',
  },
  (data) => {
    try {
      const samples16k = resampler.resample(data);

      if (samples16k.length > 0) {
        audioChunks.push(samples16k);
        totalSamples += samples16k.length;
      }

      // Process approximately every 2 seconds
      if (totalSamples >= 32000) {
        const samples = new Float32Array(totalSamples);

        let offset = 0;

        for (const chunk of audioChunks) {
          samples.set(chunk, offset);
          offset += chunk.length;
        }

        recognitionStream.acceptWaveform({
          samples,
          sampleRate: 16000,
        });

        recognizer.decode(recognitionStream);

        const result = recognizer.getResult(recognitionStream);

        console.log(
          '\n>>>',
          result?.text ?? '(no text)'
        );

        audioChunks = [];
        totalSamples = 0;
      }
    } catch (error) {
      console.error('Recognition error:', error);
    }
  }
);

console.log('');
console.log('======================================');
console.log('HINGLISH STT TEST');
console.log('======================================');
console.log('Speak naturally in Hindi/Hinglish.');
console.log('');
console.log('Example:');
console.log('  Mujhe kal NavGurukul jaana hai');
console.log('  Aaj hum project ke baare mein baat karenge');
console.log('');
console.log('Press Ctrl+C to stop.');
console.log('======================================');
console.log('');

process.on('SIGINT', () => {
  console.log('\nStopping microphone...');

  try {
    cpal.closeStream(stream);
  } catch {}

  process.exit(0);
});

console.log('Recording...');
console.log('Stream active:', cpal.isStreamActive(stream));
