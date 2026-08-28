const cpal = require("node-cpal");
const {
  OnlineRecognizer,
} = require("sherpa-onnx-node");

console.log("======================================");
console.log("Sherpa ONNX Online STT Test");
console.log("======================================");

//
// 1. Microphone
//

const inputDevice = cpal.getDefaultInputDevice();

console.log("Microphone:", inputDevice);

const inputConfig = cpal.getDefaultInputConfig(
  inputDevice.deviceId
);

console.log("Input config:", inputConfig);

//
// 2. Sherpa Online Recognizer
//

const recognizer = new OnlineRecognizer({
  featConfig: {
    sampleRate: 16000,
    featureDim: 80,
  },

  modelConfig: {
    transducer: {},
    paraformer: {},
    zipformer2Ctc: {},
    nemoCtc: {
      model: "./models/hi-model.int8.onnx",
    },

    tokens: "./models/tokens.txt",

    numThreads: 4,
    provider: "cpu",
    debug: 0,
  },

  decodingMethod: "greedy_search",

  enableEndpoint: true,

  rule1MinTrailingSilence: 1.2,
  rule2MinTrailingSilence: 0.8,
  rule3MinUtteranceLength: 20,
});

console.log("Sherpa recognizer loaded.");

//
// 3. Create streaming recognition stream
//

const stream = recognizer.createStream();

let lastText = "";

//
// 4. Microphone stream
//

console.log("");
console.log("Starting microphone...");
console.log("Speak Hindi.");
console.log("Press Ctrl+C to stop.");
console.log("");
console.log("Recording...");

const micStream = cpal.createStream(
  inputDevice.deviceId,
  true,
  {
    sampleRate: inputConfig.sampleRate,
    channels: 1,
    format: "f32",
  },
  (data) => {

    // --------------------------------
    // TODO:
    // Resample 48kHz → 16kHz
    // --------------------------------

    // Temporary test:
    // Only feed audio if already 16kHz.
    //
    // Your Mac microphone is currently
    // 48000 Hz, so DON'T send this
    // directly to Sherpa yet.

    console.log(
      "Audio:",
      data.length,
      "samples @",
      inputConfig.sampleRate,
      "Hz"
    );

  }
);

console.log(
  "Stream active:",
  cpal.isStreamActive(micStream)
);

//
// 5. Cleanup
//

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