# RFC: Offline Speech Recognition for Hindi and Marathi in the AI Tutor App

- Status: Accepted for implementation
- Owner: AI Tutor / STT Engineering
- Last Updated: 2026-09-09

## 1. Summary

This RFC describes the offline speech recognition architecture adopted for the AI tutor application, the technical decisions made, the model evaluation process, the failure modes encountered, and the final implementation path selected for Hindi and Marathi support.

The objective is to provide a local, offline, low-complexity speech-to-text path for the app without relying on cloud transcription or a Whisper-based runtime in the main product flow. The design prioritizes stability, model correctness, and deterministic routing over broad but unstable multilingual experimentation.

---

## 2. Motivation

The app needs to support student voice input in a classroom environment, primarily for Indian-language usage patterns. The product requirement includes support for:
- English
- Hindi
- Marathi
- Auto / mixed-language fallback where practical

The key constraints are:
- fully local execution;
- no cloud dependency;
- no runtime dependence on Python-only conversion or external inference services;
- acceptable latency for interactive voice-based educational support;
- correct transcription quality for actual classroom use.

The initial broad attempt to support multiple Indian-language models in parallel exposed several issues: invalid model layouts, runtime incompatibility, silent fallback to wrong models, and poor transcript quality caused by unvalidated model selection.

---

## 3. Goals

### 3.1 Functional Goals
- Support offline STT for English, Hindi, and Marathi.
- Include auto mode for general user selection.
- Keep the system robust against invalid model directories.
- Prevent false positive transcription from silent input.
- Maintain a stable fallback path with predictable behavior.

### 3.2 Non-Goals
- Supporting every possible Indian-language or code-mixed model variant immediately.
- Expanding to a broad unsupported multilingual matrix without runtime validation.
- Replacing local STT with a cloud service.
- Maintaining a multi-engine architecture with parallel active recognizers.

---

## 4. Background and Problem Context

The original product direction assumed a broad multilingual strategy that included Hindi, Hinglish, and Marathi. However, the practical implementation exposed a critical issue: several Hindi and Hinglish model options available from external sources were not directly compatible with the Sherpa runtime used by the app.

Multiple model attempts were made, including:
- generic English streamer bundles;
- Indian-English bundles;
- Hindi/Hinglish checkpoint-based bundles;
- onnx-ready Hindi attempts;
- local conversion attempts.

Many of those bundles appeared promising at the naming or repository level but failed at runtime due to one or more of the following:
- missing tokens.txt;
- incomplete encoder/decoder/joiner architecture;
- unsupported model bundle type;
- invalid or non-Sherpa layout;
- PyTorch checkpoint without conversion;
- silent fallback to wrong settings.

This created a situation where the app could launch, but the selected model was not reliably the correct one for the active language.

---

## 5. Requirements

### 5.1 Product Requirements
- The app must operate fully offline.
- It must support offline STT for English and Indian-language inputs.
- It must restrict language selection to currently supported values.
- It must avoid meaningless output from silent audio.
- It must reject invalid model directories and fail predictably rather than silently loading broken assets.

### 5.2 Engineering Requirements
- Single local recognizer path selected by language and validation.
- Deterministic routing between languages and fallback bundles.
- Model compatibility validation based on actual filesystem and bundle structure.
- Logging that clearly states the selected model directory and model type.
- Stable build and runtime validation before shipping any STT change.

---

## 6. Design Constraints

- Sherpa-ONNX is the supported model runtime in this project.
- model bundles must be local, not remote at runtime;
- no external transcription service is allowed;
- no Whisper runtime is to be treated as the primary app path;
- the architecture should remain compatible with desktop app deployment and local packaging;
- we must preserve low computational overhead and acceptable latency for repeated audio capture.

---

## 7. Proposed Architecture

### 7.1 High-level architecture
The STT pipeline consists of:
1. language normalization and input mapping;
2. model candidate resolution;
3. compatibility validation of candidate model directories;
4. selection of a valid runtime bundle;
5. initialization of the local recognizer;
6. recording and audio capture;
7. silence filtering;
8. final transcription output.

### 7.2 Language handling
The runtime accepts user input or environment configuration values and normalizes them to a supported internal set:
- en
- hi
- hi-en
- mr
- auto

The language filter resolves common aliases such as Hindi, Marathi, Hinglish, Indian English, and Auto.

### 7.3 Model resolution strategy
The model resolution path is explicitly ordered to prefer the most appropriate local bundle:
- Hindi/Marathi valid bundle first
- Indian-English bundle second
- English bundle third
- fallback only when necessary

This avoids random fallback to a generic English model when the user is clearly speaking Hindi or Marathi.

### 7.4 Bundle validation
Model validation is based on observed runtime structure, not guessed intent. A candidate directory is accepted only if:
- tokens.txt exists;
- at least one supported ONNX model file is available;
- single-model CTC bundles are usable as a single model;
- transducer bundles contain valid encoder, decoder, and joiner files when needed.

This prevents invalid model directories from entering the runtime path.

### 7.5 Silence safety
Final transcript generation is blocked unless the waveform contains meaningfully non-zero signal amplitude. This reduces false positives and prevents blank or silent input from generating transcripts.

---

## 8. Model Evaluation and Selection

### 8.1 English model
Model: sherpa-onnx-streaming-zipformer-en-20M-2023-02-17

Purpose:
- baseline support
- general fallback model
- known-good reference bundle

Outcome:
- valid and stable

### 8.2 Indian-English model
Model: sherpa-onnx-streaming-zipformer-indian-en

Purpose:
- handle Indian-accent English better than generic English
- support mixed-language classroom scenarios

Outcome:
- valid and stable

### 8.3 Hindi/Marathi selected bundle
Model: sherpa-onnx-indic-conformer

Purpose:
- main local support for Hindi and Marathi
- maintain offline product behavior without cloud dependence

Outcome:
- valid; runtime accepted; active path for Hindi/Marathi

### 8.4 Hinglish attempt
Model: sherpa-onnx-streaming-zipformer-hi-en

Purpose:
- evaluate Hindi-English mixed-language recognition capability

Outcome:
- rejected as incompatible with the current runtime path
- benchmark validated as not a usable final bundle

### 8.5 PyTorch/converted Hindi attempts
Purpose:
- explore native Hindi or Hinglish models from checkpoint sources

Outcome:
- unsupported or incomplete in current runtime
- not retained as the final implementation

---

## 9. Failure Analysis

### 9.1 Invalid model directory acceptance
Issue:
- model folders existed but were not actually compatible with the Sherpa runtime.

Impact:
- runtime initialization failure or incorrect automatic fallback;
- poor transcription quality;
- false sense of success based on file names alone.

Resolution:
- reject non-compatible bundles explicitly.

### 9.2 Wrong active model silently selected
Issue:
- app used fallback model without correcting the intended language route.

Impact:
- transcription quality degraded materially;
- Hindi/Marathi speech could be transcribed incorrectly in English-like output.

Resolution:
- route selection is deterministic and validated.

### 9.3 Ambiguous language normalization
Issue:
- Marathi and mixed-language inputs were not normalized consistently.

Impact:
- user language selection produced inconsistent runtime behavior.

Resolution:
- normalize aliases to canonical values before model lookup.

### 9.4 False output during silent input
Issue:
- blank or quiet audio still produced transcript output.

Impact:
- noise in transcript; poor UX; fake recognition.

Resolution:
- silence guard rejects non-speech input before final transcription.

---

## 10. Why the Current Design Was Chosen

The final design was chosen because it balances correctness, runtime safety, and implementation feasibility.

It includes:
- local inference only;
- no dependence on Whisper or cloud APIs;
- one active recognizer path at a time;
- robust validation of model bundles before selection;
- explicit fallback order;
- safe handling of silent audio.

This approach is preferable to a broad multi-model attempt because it reduces instability and makes the app easier to debug and support.

---

## 11. Operational and Performance Considerations

### 11.1 Latency
The architecture is designed to avoid unnecessary repeated startup and recognizer churn. Since there is only one selected recognizer path, CPU cost and model load overhead remain controlled.

### 11.2 Accuracy
The system improves accuracy by preventing invalid model selection and ensuring the chosen bundle matches the active language. This is especially important in the Hindi/Marathi path, where silent fallback previously caused major transcript errors.

### 11.3 Stability
A design that validates bundle structure before use is more stable than a naming-based or “try everything” approach. It is also easier to reason about and support in a production desktop app.

---

## 12. Risks and Trade-offs

### 12.1 Risk: model quality is not yet fully benchmarking-tested on real student speech
The current system is stable and runtime-valid, but live real-world voice quality testing is still required for exact classroom phrases.

### 12.2 Trade-off: limited support for a broader multilingual matrix
The project intentionally narrowed scope to Hindi, Marathi, and English to remain realistic and sustainable. This prioritizes correctness over expanded but unverified language support.

### 12.3 Trade-off: no broad Hinglish support at this phase
Hinglish remains a clear future requirement but was not chosen as the primary implementation due to runtime validation and product reliability constraints.

---

## 13. Validation and Evidence

The implementation was validated with the following evidence:

### Build validation
- pnpm build
- Result: success across the workspace

### Model validation
- node packages/backend/stt-engine/benchmark-stt.mjs
- Output:
  - english: tokens=true onnx=true
  - indian-english: tokens=true onnx=true
  - hindi-marathi: tokens=true onnx=true
  - hinglish: tokens=true onnx=false

Interpretation:
- English bundle valid
- Indian-English bundle valid
- Hindi/Marathi bundle valid
- Hinglish bundle not currently valid for the app path

### Silence validation
- direct runtime test on silent audio
- Output: SILENCE_RESULT: null

Interpretation:
- silent input no longer produces false transcript output

---

## 14. Implementation Notes

The current STT runtime includes explicit checks and selection flow in the backend engine. The logic now:
- normalizes language inputs;
- resolves candidate bundle families;
- validates candidates by structure and token files;
- selects the correct Hindi/Marathi path when available;
- avoids silent fallback to incompatible bundles;
- rejects blank audio before transcript emission.

This is the architecture now in place in the project.

---

## 15. Recommendation

Proceed with the current local Sherpa-ONNX architecture and retain the validated Hindi/Marathi IndicConformer path as the primary Indian-language model. Keep English and Indian-English as stable fallbacks. Continue the product scope to English, Hindi, and Marathi only until live classroom testing proves additional language support is reliable.

This is the most technically sound and deployable implementation given the constraints and evidence collected.

---

## 16. Appendix: Product Decision Summary

The product decision is to keep the voice pipeline fully offline and local, remove the Whisper-based flow from the primary path, and use a validated Sherpa model strategy with controlled fallback behavior. The core product benefit is that the app remains deterministic, local, and easier to support while preserving the ability to work across English, Hindi, and Marathi in a desktop environment.
