# STT Engine (Sherpa-ONNX)

This package runs **Sherpa-ONNX streaming ASR** for local, real-time speech recognition in the Electron app.

---

## Architecture

```text
Microphone
    ↓
16 kHz mono PCM
    ↓
Electron IPC
    ↓
Sherpa-ONNX Streaming STT
    ↓
Partial transcript
    ↓
Final transcript
    ↓
Local Ollama AI
    ↓
Streaming AI response
    ↓
Local Piper TTS
    ↓
Audio playback
```

The app uses the Sherpa streaming recognizer as the single STT runtime. Whisper is intentionally not part of the runtime path.

---

## Public API

```ts
export {
  initSherpaSTT,
  getSherpaSTT,
  SherpaStreamingSTT,
  normalizeSpeechLanguage,
  SUPPORTED_SPEECH_LANGUAGES,
  type SupportedSpeechLanguage,
} from "./sherpa.js";
```

The package exports only the runtime required by the application and does not keep legacy Whisper compatibility helpers.

---

## Data flow

1. Renderer starts the mic with `stt:start`.
2. Audio chunks are sent as `stt:chunk` in PCM format.
3. Main process converts Int16 PCM to Float32 and feeds Sherpa.
4. Sherpa returns partial text while the stream is active.
5. Endpoint detection / finalization sends `stt:final`.
6. The transcript is passed into the local AI pipeline.

---

## Requirements

- Sample rate: 16000 Hz
- Channels: 1
- Format: signed 16-bit PCM
- Endian: little-endian
- Runtime engine: Sherpa-ONNX only

---

## Notes

- The legacy `whisper-cli`, `ggml-base` and `streaming.ts` Whisper flow are removed from the active runtime path.
- The package is simplified to the canonical Sherpa implementation in `sherpa.ts`.
- No Whisper-specific binary, script, or compatibility wrapper remains in the live STT pipeline.

```bash
pnpm run dev
```

The desktop app will load `whisper-cli`, the model, and (on Linux) the shared library from `packages/backend/stt-engine/`.

### 7. Packaged build (installer)

For the **standalone installer**, STT assets go in **`apps/desktop/stt-assets/`**, not in this folder. The desktop app bundles them at build time.

- Put model and binaries in `stt-assets/win/` and `stt-assets/linux/` (see `apps/desktop/stt-assets/README.md` if present).
- Then from repo root: `pnpm run build:installer`.

---

## Quick reference

| Task | Command or location |
|------|----------------------|
| Run app (dev) | `pnpm run dev` (from repo root) |
| STT assets (dev) | `packages/backend/stt-engine/` |
| STT assets (installer) | `apps/desktop/stt-assets/win/` and `stt-assets/linux/` |
| Download model | `bash packages/backend/stt-engine/download-model.sh` |
| Copy whisper binary | `bash packages/backend/stt-engine/copy-whisper-from-idesktop.sh` |
| Build installer | `pnpm run build:installer` |

## Downloading and selecting alternate models

To download a different Sherpa streaming model (for example the Indian-English Zipformer), set the `MODEL_NAME` environment variable to the archive name and run the downloader. Example:

```bash
MODEL_NAME=sherpa-onnx-streaming-zipformer-indian-en.tar.bz2 bash packages/backend/stt-engine/download-model.sh
```

Select the model at runtime by setting the `STT_MODEL` or `SHERPA_STT_MODEL` environment variable. Supported selections include `english` (default) and `indian-english`.

Example (dev):

```bash
# Run desktop dev with the Indian-English model
STT_MODEL=indian-english pnpm --filter desktop dev

# Run desktop dev with the English model (fallback/default)
STT_MODEL=english pnpm --filter desktop dev
```

The runtime will fall back to the default English model if the requested model is missing or incompatible.
