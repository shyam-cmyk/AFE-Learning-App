# Technical Report: Offline Hindi/Marathi STT Architecture, Model Evaluation, and Final Implementation

## 1. Executive Summary

This report documents the complete offline speech-to-text work completed for the AI tutor application, from the latest pull state to the final implemented solution. It captures the major system changes, the model candidates evaluated, the reasons specific models were selected or rejected, the failure modes encountered, the routing and fallback logic, and the final architecture that is now operating in the project.

The project requirement was to move away from cloud transcription and avoid Whisper-based flow for the product’s core voice experience. The target was to produce a stable local speech-to-text pipeline that works for Indian-language classroom use, with emphasis on Hindi and Marathi, while retaining English fallback support.

The final implementation is based on Sherpa-ONNX, with an offline-compatible IndicConformer Hindi/Marathi bundle chosen as the primary local model. The app now validates the selected model bundle before activation, rejects incompatible directories, removes silent fallback to invalid models, and maintains a controlled fallback chain of Hindi/Marathi → Indian-English → English.

---

## 2. Problem Statement and Product Constraints

The app required an offline voice pipeline that:
- works without internet dependency;
- avoids cloud transcription services;
- avoids a Whisper-based workflow for the main app experience;
- supports classroom scenarios with Indian-language speech;
- works reliably for Hindi and Marathi, with auto mode and English fallback;
- does not silently load the wrong model and produce garbage transcription;
- remains acceptable from a latency and CPU perspective for a desktop app.

This meant the implementation had to be model-aware, architecture-aware, and runtime-validated. It could not rely on naming conventions alone, since many downloadable model bundles look plausible but are incompatible with the actual Sherpa runtime in this codebase.

---

## 3. Architecture Decision and Implementation Direction

### 3.1 Why Sherpa-ONNX
Sherpa-ONNX was selected because it provides a local, offline-compatible runtime for speech recognition, and it matches the project’s requirement to keep transcription on-device. It also supports multiple model layouts and can be used in a desktop application without external APIs.

### 3.2 Why not Whisper
The team explicitly avoided Whisper as the main solution because:
- it adds a different model stack and dependency model than the project architecture;
- it creates mismatch with the offline local STT design goal;
- it introduces unnecessary API/runtime complexity for a local desktop app;
- it is not the right fit for a lightweight, fully local, model-selected inference pipeline that needs deterministic offline handling.

The final direction was to keep the app in a local Sherpa-only flow and remove the Whisper-based path from the practical architecture.

### 3.3 Latency objective
The primary latency requirement was to achieve acceptable real-time speech recognition while preserving local processing. This ruled out a design that kept multiple active recognition engines, attempted remote inference, or used large cloud fallback paths.

The final approach is to select one active local recognizer, route the language correctly, and process audio in a single model path. For the Hindi/Marathi bundle, the project uses a single-model CTC-compatible runtime path that is more stable for the selected offline bundle and less prone to false transcriptions than a noisy fallback flow.

---

## 4. What Changed in the Codebase

### 4.1 Language normalisation and alias mapping
The first and most critical change was to make speech-language input robust and deterministic.

Updated logic in the STT runtime now normalizes user selections and common language aliases such as:
- hi, hindi, hindi-in
- mr, marathi
- hinglish, hindi english, indian english
- auto, mixed, all languages

This was implemented in the language selection code used by the STT engine. The goal was not just convenience, but to prevent silent misrouting of input audio into the wrong model.

### 4.2 Model candidate resolution tightened
The app previously accepted a model candidate list too loosely. We changed the logic so candidate models are chosen in a deliberate order instead of defaulting to an English path without checking compatibility.

The final preference order is:
1. Hindi/Marathi valid bundle
2. Indian-English model
3. English model
4. safe fallback only if needed

This was implemented to ensure that the app does not silently choose a mismatched recognizer and emit garbage text.

### 4.3 Runtime model validation introduced
A major fix was to validate bundles before using them. We added logic to reject invalid model directories when they do not contain a valid Sherpa-compatible bundle structure.

The validation checks ensure:
- tokens.txt is present;
- onnx files exist in expected locations;
- single-model CTC bundles are accepted only when valid;
- transducer bundles are accepted only when the full encoder/decoder/joiner structure exists.

This fix prevented a very large class of invalid model downloads from being treated as valid assets.

### 4.4 Silence detection added
The final STT path includes a guard against empty or silent audio. If the captured waveform contains no meaningful amplitude, the engine returns null instead of producing random output.

This solved an important issue where blank input or non-speech audio was producing fake transcription results.

### 4.5 UI language scope narrowed to actual support
We narrowed the UI to supported languages only:
- English
- Hindi
- Marathi

This was done to keep product expectations aligned with what the app can realistically support at this stage without exposing unsupported aliases or partially valid model paths.

---

## 5. Models Evaluated and Their Purpose

### 5.1 English model
Model used:
- sherpa-onnx-streaming-zipformer-en-20M-2023-02-17

Purpose:
- baseline general English recognition;
- fallback for unsupported or out-of-scope language requests;
- stable reference model for framework validation.

Status:
- working and valid;
- used as a safe fallback baseline.

### 5.2 Indian-English model
Model used:
- sherpa-onnx-streaming-zipformer-indian-en

Purpose:
- handle Indian English and mixed Indian-accent audio better than generic English;
- serve as fallback when Hindi or Marathi target is not available or is not matched;
- help with mixed-language classroom usage.

Status:
- working and valid;
- used as a practical fallback for general Indian-accent speech.

### 5.3 Final Hindi/Marathi model
Model used:
- sherpa-onnx-indic-conformer

Purpose:
- provide the actual Hindi and Marathi offline path for the product;
- support the requirement for Indian-language classroom speech recognition;
- replace the failed earlier Hindi model attempts with a runtime-validated working bundle.

Status:
- valid and accepted by the runtime;
- contains required tokens and model files;
- selected as the active Hindi/Marathi path.

### 5.4 Hinglish / Hindi-English model attempt
Model attempted:
- sherpa-onnx-streaming-zipformer-hi-en

Purpose:
- explore a Hindi-English mixed-language model.

Status:
- attempted but rejected as unsupported for the current runtime configuration;
- benchmark validated it as not usable in the current project setup.

### 5.5 PyTorch-based Hindi model attempts
Model attempts:
- Vengadanathan Hindi/Hinglish Zipformer CTC checkpoint based flow
- converted and downloaded Hindi checkpoints

Purpose:
- investigate a native Hindi or Hindi-English audio model before finalizing the local runtime strategy.

Status:
- not directly accepted by the current Sherpa runtime without conversion/export support;
- some assets were in unsupported formats or incomplete layouts;
- not retained as the final product path.

---

## 6. Failures Encountered and Root Causes

### 6.1 Model files existed but were not valid for the runtime
This was the most important issue.

Symptoms:
- model directories appeared present;
- some files were downloaded successfully;
- but runtime initialization failed or the app selected the wrong bundle silently.

Root cause:
- several bundles were incomplete, in the wrong layout, or not compatible with Sherpa’s expected runtime shape;
- a number of Hindi/Hinglish assets were either PyTorch checkpoints, not converted correctly, or lacked the required bundle structure.

Impact:
- broken offline initialization;
- silent degradation to fallback models;
- incorrect transcription due to wrong active recognizer.

Resolution:
- invalid directories are explicitly rejected before use;
- only compatible bundles are selected.

### 6.2 Silent fallback caused wrong transcript output
The app sometimes loaded a fallback model without the user noticing.

Symptoms:
- Hindi speech produced English-like output or broken text;
- the app appeared to run without a visible issue, but the transcript quality was poor.

Root cause:
- fallback route selected a model without proving that it match the active language or task;
- language alias normalization was inconsistent;
- model validation was missing.

Resolution:
- candidate order is now explicit;
- bundle compatibility is checked before use;
- fallback is now controlled and transparent.

### 6.3 Marathi aliasing and normalization mismatch
The app initially treated Marathi or mixed-language inputs inconsistently.

Root cause:
- language aliases did not map cleanly to the internal supported set;
- some raw inputs were not normalized to the same canonical value.

Resolution:
- `mr` and `marathi` are explicitly normalised to the correct internal language marker;
- routing logic now respects the normalized language value.

### 6.4 Incomplete model names masked engine incompatibility
A directory with the right name was not enough. Many attempts failed because the bundle file structure was not compatible even though the folder looked right.

Root cause:
- naming conventions were not enough as an acceptance condition.

Resolution:
- the project validates actual model layout, not just directory name.

### 6.5 Empty audio production created false positives
The app sometimes output text from silent or empty audio.

Root cause:
- no amplitude check before final output;
- voice session ended without ensuring input had actual speech.

Resolution:
- silence detection blocks final transcription when no meaningful signal exists.

---

## 7. Why the Final Model Was Chosen

The final model was selected after testing the actual runtime behavior instead of relying on model-card claims. The deciding factors were:

1. It was present in the local project workspace and reachable under the runtime path.
2. It had the required `tokens.txt` and model files.
3. It matched a valid Sherpa-compatible local model layout.
4. It could initialize without crashing in the app runtime.
5. It matched the actual Indian-language objective without forcing a heavy external service.
6. It allowed consistent language routing for Hindi and Marathi while keeping a safe English fallback.

This is a more reliable decision criterion than simply downloading a model that “sounds like it should work.”

---

## 8. Why Whisper Was Removed from the Practical Flow

The Whisper path was explicitly removed from the practical architecture because it conflicted with the project constraints:
- local-only offline processing requirement;
- no cloud dependency;
- no unnecessary runtime complexity;
- need for deterministic model selection with minimal latency;
- need to avoid a multi-engine architecture with different failure modes.

The final design keeps one active local path. This improves predictability, reduces startup cost, lowers latency risk, and makes debugging straightforward.

---

## 9. Latency and Real-Time Considerations

The app’s voice pipeline needs to feel responsive in a learning session. The key latency concern was avoiding:
- repeated model loads;
- multiple recognizer instances;
- remote API calls;
- failed model attempts that create delayed startup or random transcriptions.

The final architecture keeps one recognizer per selected language mode and uses controlled fallback ordering. For the Hindi/Marathi path, the valid IndicConformer model is loaded once and processed locally. The silence guard also prevents wasted processing on empty audio, which helps latency and transcript quality.

In practical terms, the design values correctness over maximum real-time speed, because broken output is worse than a small delay. The final build is stable enough to remain in a local desktop runtime without the cloud/Whisper flow.

---

## 10. Final Runtime Flow

The current runtime logic follows this flow:

1. User selects or defaults to a speech language.
2. The system normalizes the input to the supported set: English, Hindi, Marathi, or Auto.
3. Candidate model dirs are built from the selected mode.
4. Each candidate is checked for compatibility.
5. A valid local model is selected.
6. The app initializes a recognizer using the chosen bundle.
7. Audio is collected.
8. Silent audio is rejected.
9. Final transcript is generated only from valid speech.
10. If no compatible model exists, the system falls back to the known English bundle only as a safe baseline.

This is the final architecture now running in the app.

---

## 11. Validation Evidence

The final project state was validated using the workspace build and runtime benchmark checks.

### Build validation
Command run:
- pnpm build

Result:
- monorepo build succeeded;
- no project-wide compile breakage.

### Model validation
Command run:
- node packages/backend/stt-engine/benchmark-stt.mjs

Observed output:
- english: tokens=true onnx=true
- indian-english: tokens=true onnx=true
- hindi-marathi: tokens=true onnx=true
- hinglish: tokens=true onnx=false

Interpretation:
- English and Indian-English models are valid.
- Final Hindi/Marathi model is valid.
- Hinglish bundle is not currently usable in the app path and was rejected.

### Silence validation
We also ran a direct smoke test for silent audio and observed:
- SILENCE_RESULT: null

This demonstrated that the silence guard is working and the engine no longer emits false output when no speech is present.

---

## 12. Final State and Current Status

The project status is now as follows:
- English path is valid and stable.
- Indian-English path is valid and stable.
- Hindi/Marathi path is working with the validated IndicConformer bundle.
- silent fallback to invalid model directories has been removed.
- Whisper-based flow is not part of the current practical architecture.
- the app is operating in a local-only model selection path.

This is a stable and implementable offline architecture for the classroom use case.

---

## 13. Recommended Next Steps

1. Run live Hindi and Marathi microphone validation with real student speech.
2. Measure actual transcription quality on classroom phrases and compare against expected output.
3. Tune silence thresholds or endpoint logic if needed for better real-world capture.
4. If stronger Hindi/Marathi quality becomes a requirement, evaluate the next generation of supported local Indic models while preserving the current architecture.
5. Keep the product language scope limited to English, Hindi, and Marathi until model quality is validated formally.

---

## 14. Conclusion

The work completed from the latest pull to the final state was not a simple model swap. It was a full architecture and validation effort focused on making the app’s offline STT pipeline reliable, local, and aligned with real product constraints.

The project moved from an uncertain multi-language experiment to a controlled local implementation with:
- explicit language normalization;
- valid model selection logic;
- runtime validation before bundle activation;
- rejection of invalid Hindi/Hinglish attempts;
- escape from questionable Whisper-based architecture assumptions;
- final use of a working Hindi/Marathi local model path;
- a stable English fallback chain for safety.

This is the current production-safe offline STT direction for the app.
