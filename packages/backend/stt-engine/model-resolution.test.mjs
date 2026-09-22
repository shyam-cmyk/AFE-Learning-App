import assert from 'node:assert/strict';
import { resolveModelCandidates, normalizeSpeechLanguage } from './dist/index.js';

const autoCandidates = resolveModelCandidates('auto');
assert.ok(
  autoCandidates.some((candidate) => candidate.includes('indic') || candidate.includes('hi-en')),
  'auto mode should prefer Hinglish/Indic paths before plain English fallback',
);

const hiCandidates = resolveModelCandidates('hi');
assert.ok(
  hiCandidates.some((candidate) => candidate.includes('indic') || candidate.includes('zipformer-hi')),
  'Hindi should prefer Hindi model candidates',
);

const mixed = normalizeSpeechLanguage('Hindi / Hinglish');
assert.equal(mixed, 'hi-en', 'Hindi/Hinglish language normalization should resolve to hi-en');

console.log('model-resolution checks passed');
