# STT Engine (Sherpa-ONNX)

This package runs **Sherpa-ONNX streaming ASR** for local, real-time speech recognition in the Electron app.

## 🇬🇧 🇮🇳 Language Support

The app is designed to work with English, Hindi, and Hinglish (Hindi-English code-switching) for Indian students.

**Current models**:
- ✓ English streaming model (default fallback)
- ✓ Indian-English streaming model
- ⚠️ Hindi/Hinglish model (setup required — see [HINDI_SETUP.md](./HINDI_SETUP.md))

**Auto mode** (recommended):
The app automatically selects the best model based on the language spoken by the student.

**For Hindi/Hinglish support**, follow the setup guide: [HINDI_SETUP.md](./HINDI_SETUP.md)

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

## Data Flow

1. Renderer starts the microphone with `stt:start`.
2. Audio chunks are sent as `stt:chunk` in PCM format.
3. The main process converts Int16 PCM to Float32 and feeds Sherpa-ONNX.
4. Sherpa-ONNX returns partial text while the stream is active.
5. Endpoint detection and finalization send `stt:final`.
6. The transcript is passed into the local AI pipeline.

---

## Requirements

* **Sample rate:** 16000 Hz
* **Channels:** 1
* **Format:** Signed 16-bit PCM
* **Endian:** Little-endian
* **Runtime engine:** Sherpa-ONNX only

---

## Runtime Model

The STT engine uses Sherpa-ONNX streaming models.

The runtime supports model selection through environment variables.

Supported model selections include:

* `english` — default English model
* `indian-english` — Indian English model

The runtime falls back to the default English model if the requested model is missing or incompatible.

---

## Development

Run the application from the repository root:

```bash
pnpm run dev
```

During development, the desktop application loads the required Sherpa-ONNX STT model and runtime assets from the STT engine package.

---

## Model Assets

Development STT assets are stored in:

```text
packages/backend/stt-engine/
```

For packaged builds, STT assets are stored separately under:

```text
apps/desktop/stt-assets/
```

The desktop application bundles the required STT assets into the installer during the production build.

---

## Packaged Build

For the **standalone installer**, STT assets go in:

```text
apps/desktop/stt-assets/
```

They should not be placed in the development STT package for the packaged application.

Expected platform-specific locations are:

```text
apps/desktop/stt-assets/win/
apps/desktop/stt-assets/linux/
```

See `apps/desktop/stt-assets/README.md` if that file is present for the expected asset layout.

Build the installer from the repository root:

```bash
pnpm run build:installer
```

---

## Quick Reference

| Task                           | Command or location                                  |
| ------------------------------ | ---------------------------------------------------- |
| Run app (dev)                  | `pnpm run dev` from repo root                        |
| STT assets (dev)               | `packages/backend/stt-engine/`                       |
| STT assets (Windows installer) | `apps/desktop/stt-assets/win/`                       |
| STT assets (Linux installer)   | `apps/desktop/stt-assets/linux/`                     |
| Download model                 | `bash packages/backend/stt-engine/download-model.sh` |
| Build installer                | `pnpm run build:installer`                           |

---

## Downloading and Selecting Alternate Models

To download a different Sherpa-ONNX streaming model, set the `MODEL_NAME` environment variable to the archive name and run the downloader.

For example, to download the Indian-English Zipformer model:

```bash
MODEL_NAME=sherpa-onnx-streaming-zipformer-indian-en.tar.bz2 \
bash packages/backend/stt-engine/download-model.sh
```

### Selecting a Model at Runtime

Set either `STT_MODEL` or `SHERPA_STT_MODEL`.

### Indian English

```bash
STT_MODEL=indian-english pnpm --filter desktop dev
```

### Default English

```bash
STT_MODEL=english pnpm --filter desktop dev
```

The runtime will fall back to the default English model if the requested model is missing or incompatible.

---

## Supported Speech Languages

The package exposes the following language-related API:

```ts
normalizeSpeechLanguage
SUPPORTED_SPEECH_LANGUAGES
type SupportedSpeechLanguage
```

The supported language configuration is defined by the Sherpa-ONNX implementation in `sherpa.ts`.

---

## Notes

* Sherpa-ONNX is the only active STT runtime.
* The legacy Whisper runtime is not part of the active STT pipeline.
* Legacy `whisper-cli`, `ggml-base`, and Whisper streaming compatibility code should not be required by the application.
* The canonical implementation is located in `sherpa.ts`.
* STT processing is performed locally.
* Audio is converted from Int16 PCM to Float32 before being passed to the recognizer.
* The STT pipeline supports partial and final transcripts.
* Model selection can be controlled through environment variables.

---

## Troubleshooting

### Model Not Found

If the requested model is unavailable, verify that the model assets exist in the expected STT asset directory.

For development:

```text
packages/backend/stt-engine/
```

For packaged builds:

```text
apps/desktop/stt-assets/win/
apps/desktop/stt-assets/linux/
```

### Requested Model Is Not Loading

Verify the selected model name:

```bash
echo $STT_MODEL
```

Try the default English model:

```bash
STT_MODEL=english pnpm --filter desktop dev
```

If the requested model is missing or incompatible, the runtime should fall back to the default English model.

### Installer STT Assets

If STT works during development but not in the packaged application, verify that the required model and platform-specific runtime assets are present under:

```text
apps/desktop/stt-assets/
```

Then rebuild the installer:

```bash
pnpm run build:installer
```

---

## Package Structure

The STT engine package contains the Sherpa-ONNX implementation and supporting model/runtime assets.

```text
packages/backend/stt-engine/
├── sherpa.ts
├── download-model.sh
├── README.md
└── <model/runtime assets>
```

The exact asset structure may vary depending on the selected Sherpa-ONNX model.

---

## Runtime Flow

```text
Microphone
    ↓
PCM Audio
    ↓
Electron IPC
    ↓
Sherpa-ONNX
    ↓
Partial / Final Transcript
    ↓
Local AI Tutor
```

The STT engine is intentionally isolated from the renderer and communicates with the frontend through the application's IPC layer.
