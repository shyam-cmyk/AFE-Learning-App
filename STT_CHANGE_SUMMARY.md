# Offline STT Change Summary: Latest Pull to Current State

## 1. Purpose
This document captures what changed from the latest pull to the current implementation, the approach used, the model decisions, the failures encountered, the issues we fixed, and the final working state for offline speech recognition in the app.

---

## 2. Scope and Goal
We needed a fully local/offline STT path for the AI tutor app, with a practical and reliable setup for Indian-language speech, especially:
- Hindi
- Marathi
- Auto language detection / mixed-language fallback

The requirement was to stay within the Sherpa-ONNX local runtime model flow and avoid cloud-based transcription or Python-based runtime dependency for the app itself.

---

## 3. What Changed From the Latest Pull to Now

### Change 1: Language normalization and selector handling
We improved the language selection logic so the app can normalize different user inputs and resolve the correct speech mode.

Files involved:
- `packages/backend/stt-engine/sherpa.ts`

Updated behavior:
- `normalizeSpeechLanguage()` now maps inputs like:
  - `hi`, `hindi`, `hindi-in`
  - `mr`, `marathi`
  - `hinglish`, `hindi english`, `indian english`
  - `auto`, `mixed`, `all languages`
- This fixed cases where the app was misclassifying language requests or silently defaulting to the wrong model.

### Change 2: Model candidate resolution was hardened
We changed how candidate models are chosen before runtime initialization.

Updated behavior:
- `resolveModelCandidates()` now prefers valid Hindi/Marathi bundles first rather than blindly choosing a generic English path.
- The app explicitly prefers:
  - `sherpa-onnx-indic-conformer`
  - then Indian-English / English fallbacks
- This avoids random fallback behavior where a bad or mismatched model can silently load.

### Change 3: Compatibility validation before accepting a model
We added explicit checks so invalid directories are rejected before being used.

Validation logic added:
- `hasCompatibleOnlineModel()`
- checks for required `tokens.txt`
- checks for valid ONNX bundle structure
- accepts single-model bundles like `model.int8.onnx`
- accepts complete transducer bundles with encoder/decoder/joiner files

This was important because many model downloads looked correct at the file level but were not actually useable by Sherpa runtime.

### Change 4: Hindi/Marathi runtime mode switched to offline CTC-compatible path
The final working model was identified as a single-model CTC bundle layout, which is different from the standard streaming transducer arrangement.

Current runtime behavior:
- if the selected model is a single-model CTC bundle, the app uses the offline recognizer path
- audio is collected, silence is filtered, and final transcription is produced after recording ends

This is specifically used for the successful Hindi/Marathi path.

### Change 5: Silence guard added
We added a guard to prevent incorrect outputs from empty or silent audio.

Behavior:
- if no meaningful amplitude is present, the recognizer returns `null`
- this removed false positives from blank or non-speech input

### Change 6: App UI language scope reduced to supported languages
We narrowed the UI options to the languages we can genuinely support right now:
- English
- Hindi
- Marathi

This avoids exposing unsupported / partially working language options that cause confusion.

---

## 4. Approach We Used

### Overall strategy
The project followed a practical, evidence-based approach:
1. Start with official Sherpa bundles already available in the repo
2. Add language normalization and model selection logic
3. Evaluate multiple Hindi and Indian-language model sources
4. Reject invalid bundles instead of silently falling back
5. Select a working local bundle that matches the actual Sherpa runtime model shape
6. Validate the build and model runtime behavior before treating it as accepted

### Model selection strategy
The final route was:
- English model: `sherpa-onnx-streaming-zipformer-en-20M-2023-02-17`
- Indian-English model: `sherpa-onnx-streaming-zipformer-indian-en`
- Hindi/Marathi working bundle: `sherpa-onnx-indic-conformer`
- Auto route: first try Hindi/Marathi working bundle, then Indian-English, then English

This is implemented in `resolveModelCandidates()` and used through `resolveModelDir()`.

---

## 5. Models Tried and Evaluated

### A. English model (working)
Model:
- `sherpa-onnx-streaming-zipformer-en-20M-2023-02-17`

Status:
- Valid and working
- Used as baseline and fallback

### B. Indian-English model (working)
Model:
- `sherpa-onnx-streaming-zipformer-indian-en`

Status:
- Valid and working
- Reasonable fallback for mixed Indian-language audio

### C. Hindi/Marathi final working bundle
Model:
- `sherpa-onnx-indic-conformer`

Status:
- Valid bundle found and accepted by runtime
- Contains required `tokens.txt`
- Uses `model.int8.onnx` bundle layout
- Active Hindi/Marathi path

### D. Hinglish / Hindi-English model attempt (rejected)
Model attempt:
- `sherpa-onnx-streaming-zipformer-hi-en`

Status:
- Downloaded and inspected
- Rejected as invalid/unsupported for the current app path
- Benchmark showed `onnx=false`

### E. PyTorch / conversion attempts
Models tried:
- Vengadanathan Hindi/Hinglish Zipformer CTC checkpoint
- converted/downloaded Hindi model attempts

Status:
- Not directly usable by the current Sherpa runtime without proper conversion/export
- Some files ended up as `.pt` or unsupported bundle layouts

---

## 6. Failures and Problems We Ran Into

### Issue 1: Hindi/Hinglish model looked promising but was not runtime-compatible
This was a major issue.

Symptoms:
- Model files existed
- Some downloads looked valid
- But runtime initialization still failed or rejected them

Root cause:
- Files were incomplete, wrong format, or not in a Sherpa-compatible bundle layout
- Some were PyTorch checkpoints or unsupported bundle variants

Solution:
- We added strict compatibility checks and rejected invalid bundles instead of forcing a load

### Issue 2: Silent fallback to English/Indian-English caused incorrect transcription
This created bad results such as weird or unrelated English output when the user was actually speaking Hindi/Marathi.

Root cause:
- The app was choosing a model path that looked plausible but was not the actual desired language bundle
- Combined with weak language normalization and ambiguous selectors

Solution:
- We made the active model selection explicit and validated
- We prioritized the correct Hindi/Marathi path
- We prevented silent fallback when a valid model was available

### Issue 3: Marathi was being normalized ambiguously
Some aliasing caused Marathi values to be treated incorrectly or too loosely

Root cause:
- Inconsistent alias mapping between raw selector and normalized language

Solution:
- We normalized `mr` and `marathi` explicitly in `normalizeSpeechLanguage()` and selection logic

### Issue 4: Model names alone were misleading
Name-based detection was not sufficient.

Root cause:
- A directory could have the right name but not the right validity for Sherpa runtime

Solution:
- We tested actual filesystem structure and required model files (`tokens.txt`, `encoder/decoder/joiner` or single ONNX model)

### Issue 5: Empty or silent audio produced false results
This caused noisy outputs or invalid text even when no speech was present

Solution:
- We added an amplitude-based silence check before final transcription

---

## 7. Actual Logs / Validation Evidence

### Build validation
Command run:
- `pnpm build`

Result:
- build succeeded across the monorepo
- no workspace build breakage

### STT benchmark validation
Command run:
- `node packages/backend/stt-engine/benchmark-stt.mjs`

Key output:
- `english: tokens=true onnx=true`
- `indian-english: tokens=true onnx=true`
- `hindi-marathi: tokens=true onnx=true`
- `hinglish: tokens=true onnx=false`

This confirmed that the final Hindi/Marathi bundle is the valid one and the Hinglish-only bundle is not usable for the current setup.

### Silence validation
Command run:
- a direct STT smoke test with silent audio

Observed output:
- `SILENCE_RESULT: null`

This confirms the silence guard is working as intended.

### Runtime initialization validation
We confirmed the app now selects the correct folder and loads a compatible model without crashing.

Key evidence:
- `Model directory: .../sherpa-onnx-indic-conformer`
- `Model type: IndicConformer CTC (offline decode)`
- `HI_RUNTIME_OK`, `MR_RUNTIME_OK`, `AUTO_RUNTIME_OK` in the working validation flow

---

## 8. Final Current State
The app is now in a stable state with:
- working English fallback
- working Indian-English fallback
- working Hindi/Marathi selected model path
- explicit rejection of incompatible bundles
- auto-selection logic that prefers the valid Hindi/Marathi bundle
- silence protection to prevent garbage transcription

Current practical status:
- The offline runtime is working for Hindi/Marathi selection and initialization.
- The app is no longer silently selecting broken Hindi models.
- Real-world microphone accuracy still needs live verification with actual Hindi/Marathi student speech to measure polish and clarity.

---

## 9. Recommended Next Step
The next critical validation is live audio testing on actual Hindi and Marathi student speech.

Priority checks:
1. Speak a Hindi phrase like: “Kya aap mujhe sun pa rahe ho?”
2. Test a Marathi phrase with normal classroom pronunciation
3. Confirm returned transcription is meaningful and not random
4. If needed, tune endpoint/silence thresholds or replace with a stronger model later

---

## 10. Conclusion
The app evolved from a broad but ambiguous multilingual STT setup into a focused, validated local strategy:
- official English + Indian-English support remains solid
- Hindi/Marathi is handled by the valid `IndicConformer` bundle
- invalid model attempts were rejected deliberately rather than silently accepted
- the runtime now avoids the major failure path that previously caused garbage transcription and incorrect language selection

This is the current working, project-safe solution we have in place.
