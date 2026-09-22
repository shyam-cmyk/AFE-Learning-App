import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
  { name: 'english', dir: path.join(__dirname, 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17') },
  { name: 'indian-english', dir: path.join(__dirname, 'sherpa-onnx-streaming-zipformer-indian-en') },
  { name: 'hindi-marathi', dir: path.join(__dirname, 'sherpa-onnx-indic-conformer') },
  { name: 'hinglish', dir: path.join(__dirname, 'sherpa-onnx-streaming-zipformer-hi-en') },
  { name: 'auto', dir: null },
];

function hasOnnxFiles(dir) {
  const hasSingleModel = ['model.onnx', 'model.int8.onnx'].some((file) =>
    fs.existsSync(path.join(dir, file))
  );
  if (hasSingleModel) return true;

  // The desktop STT path uses Sherpa's online transducer API.
  return ['encoder', 'decoder', 'joiner'].every((base) =>
    fs.existsSync(path.join(dir, `${base}.onnx`)) ||
    fs.existsSync(path.join(dir, `${base}.int8.onnx`)) ||
    fs.existsSync(path.join(dir, `${base}-epoch-99-avg-1.int8.onnx`)) ||
    fs.existsSync(path.join(dir, `${base}-epoch-10-avg-5-chunk-64-left-256.int8.onnx`))
  );
}

for (const model of candidates) {
  if (!model.dir) {
    console.log(`[benchmark] ${model.name}: auto-selection mode enabled`);
    continue;
  }

  const hasTokens = fs.existsSync(path.join(model.dir, 'tokens.txt'));
  const hasOnnx = hasOnnxFiles(model.dir);

  console.log(`[benchmark] ${model.name}: tokens=${hasTokens} onnx=${hasOnnx} dir=${model.dir}`);
}

console.log('[benchmark] benchmark harness ready');
