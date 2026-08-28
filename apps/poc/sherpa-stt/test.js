const cpal = require('node-cpal');
const sherpa = require('sherpa-onnx-node');

const SAMPLE_RATE = 16000;

console.log('Initializing microphone...');

const inputDevice = cpal.getDefaultInputDevice();

console.log('Microphone:', inputDevice);

// const inputConfig = cpal.getDefaultInputConfig(inputDevice);
const inputConfig = cpal.getDefaultInputConfig(inputDevice.deviceId);

console.log('Input config:', inputConfig);

// Convert Mac microphone audio from 48 kHz → 16 kHz
const resampler = new sherpa.LinearResampler(inputConfig.sampleRate, SAMPLE_RATE);

// Hindi IndicConformer
const recognizer = new sherpa.OfflineRecognizer({
  featConfig: {
    sampleRate: SAMPLE_RATE,
    featureDim: 80,
  },

  modelConfig: {
    transducer: {},
    paraformer: {},
    zipformer: {},
    nemoCtc: {
      model: './models/hi-model.int8.onnx',
    },
    tokens: './models/tokens.txt',
    numThreads: 4,
    provider: 'cpu',
    debug: 0,
  },

  decodingMethod: 'greedy_search',
});

console.log('Hindi model loaded.');
console.log('Starting microphone...');
console.log('Speak Hindi/Hinglish.');
console.log('Press Ctrl+C to stop.\n');

let audioBuffer = [];
let processing = false;

const stream = cpal.createStream(
  inputDevice.deviceId,
  true,
  {
    sampleRate: inputConfig.sampleRate,
    channels: inputConfig.channels,
    format: 'f32',
  },
  (data) => {
    // data is Float32Array at 48 kHz
    const resampled = resampler.resample(data);

    audioBuffer.push(...resampled);

    // Process roughly 2 seconds of audio
    if (audioBuffer.length >= SAMPLE_RATE * 2 && !processing) {
      processing = true;

      const samples = audioBuffer.splice(0, SAMPLE_RATE * 2);

      try {
        const recognitionStream = recognizer.createStream();

        recognitionStream.acceptWaveform({
          sampleRate: SAMPLE_RATE,
          samples: Float32Array.from(samples),
        });

        // const result = recognizer.decode(recognitionStream);

        // if (result.text) {
        //   console.log('🗣️', result.text);
        // }
        const result = recognizer.getResult(recognitionStream);
        if (result.text) {
          console.log('🗣️', result.text);
        }
      } catch (error) {
        console.error('Recognition error:', error);
      } finally {
        processing = false;
      }
    }
  }
);

console.log('Recording...');

console.log('Stream active:', cpal.isStreamActive(stream));

process.on('SIGINT', () => {
  console.log('\nStopping microphone...');

  cpal.closeStream(stream);

  process.exit(0);
});
