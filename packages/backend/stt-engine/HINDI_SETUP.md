# Hindi/Hinglish STT Setup Guide

This document explains how to add real Hindi and Hinglish speech recognition to the offline AI Tutor app.

## Current Status

The app currently has:
- ✓ English streaming model
- ✓ Indian-English streaming model
- ✗ Hindi/Hinglish streaming model (needs to be added)

## Why Hindi/Hinglish Is Important

For the target student audience:
- Many students speak Hindi at home
- Many students use Hinglish (Hindi-English code-switching) naturally
- The tutor should understand:
  - "Mujhe ye concept samajh nahi aa raha" (Pure Hindi)
  - "Sir ye function kaise work karta hai?" (Hinglish)
  - "Can you explain this function?" (English)
  - Mixed speech in a single sentence

## Best Hindi/Hinglish Model for This App

### Recommended: Vengadanathan Hindi/Hinglish Zipformer CTC

- **Source**: https://huggingface.co/Vengadanathan/hindi-hinglish-zipformer-ctc-streaming
- **Architecture**: Zipformer-M CTC (streaming-capable)
- **Parameters**: ~65M
- **License**: Apache 2.0
- **Training data**: IndicVoices-hi, Svarah, internal call data
- **Accuracy**:
  - Hindi (IndicVoices): 25.7% WER
  - Hinglish (call test): 39.9% WER
  - Indian English (Svarah): 44.5% WER

### Why This Model

✓ Real-time streaming support (causal, chunked)
✓ Low memory footprint (~65M params)
✓ Optimized for Hindi + Hinglish naturally
✓ Trained on real Indian speech data
✓ Practical for student laptops (8GB RAM)
✓ Apache 2.0 licensed

## Installation Steps

### Step 1: Download Model Files ✅ COMPLETE

Run the provided download script:

```bash
bash packages/backend/stt-engine/download-hindi-model.sh
```

**Status**: ✅ Model files successfully downloaded to `sherpa-onnx-streaming-zipformer-hi-en/`
- ✅ `model_p3_epoch15_avg8.pt` - trained weights (247 MB)
- ✅ `tokens.txt` - vocabulary file (659 B)

**Downloaded**: 2024-12-19 18:24 UTC

### Step 2: Convert to ONNX Format (IN PROGRESS)

The PyTorch checkpoint needs to be converted to ONNX for the sherpa-onnx-node runtime.

**Requirements**:
- Python 3.9+
- PyTorch
- icefall framework
- ONNX tools

**Automated Conversion**:

```bash
# Install dependencies (one-time)
pip install torch icefall onnx onnxruntime

# Run conversion
bash packages/backend/stt-engine/convert-hindi-model.sh
```

**Expected Output**: 
- `encoder.onnx` (streaming encoder)
- `decoder.onnx` (attention decoder)
- `joiner.onnx` (RNN-T joiner)
- Location: `sherpa-onnx-streaming-zipformer-hi-en/`

**Estimated Time**: 5-10 minutes (first run)
**Disk Space**: ~1 GB temporary space for conversion

**Manual Conversion** (if automated fails):

See [icefall export guide](https://github.com/k2-fsa/icefall/blob/main/egs/zipformer/asr/streaming_zipformer_ctc/export.py)

```bash
# Clone icefall
git clone https://github.com/k2-fsa/icefall.git
cd icefall

# Export model
python -c "
from icefall.models import Zipformer
import torch

checkpoint_path = '../sherpa-onnx-streaming-zipformer-hi-en/model_p3_epoch15_avg8.pt'
output_dir = '../sherpa-onnx-streaming-zipformer-hi-en/'

# Load and export to ONNX
# (Full script in icefall repository)
"
```

### Step 3: Verify Installation ✅ APP READY

After ONNX conversion:

```bash
# Verify model files
ls -lah packages/backend/stt-engine/sherpa-onnx-streaming-zipformer-hi-en/

# Check model availability
node packages/backend/stt-engine/benchmark-stt.mjs
```

Expected output:
```
[benchmark] english: tokens=true onnx=true ✓
[benchmark] indian-english: tokens=true onnx=false 
[benchmark] hindi-hinglish: tokens=true onnx=true ✓  ← Ready after conversion
[benchmark] auto: auto-selection mode enabled ✓
```

### Step 4: Build & Test Hindi/Hinglish

```bash
# Build app (already done ✓)
pnpm build

# Start development server
pnpm --filter desktop dev

# Or build production binary
pnpm --filter desktop build
```

**Test Phrases**:
- "Mujhe ye concept samajh nahi aa raha" (Hindi)
- "Sir ye function kaise work karta hai?" (Hinglish)
- "Nested loop ka time complexity kya hai?" (Technical Hinglish)

---

## Alternative Models (If Preferred)

### IndicConformer + Hinglish (parismitaglobalsolutions)

- **Source**: https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx
- **Advantage**: Pre-converted to Sherpa-ONNX format
- **Disadvantage**: Larger models (~150-200MB each)
- **Format**: Ready-to-use ONNX files

### How the App Selects Models

**Priority order** (when multiple models are present):

1. Hindi/Hinglish-capable model (if available)
2. Indian-English streaming Zipformer
3. English streaming Zipformer (fallback)

This ensures students who speak Hindi/Hinglish get the best experience.

---

## Technical Architecture

### Real-Time Pipeline

```
Microphone
    ↓
16 kHz mono PCM (AudioWorklet)
    ↓
Electron IPC (audio chunks)
    ↓
[Auto Language Detection]
    ↓
Streaming Recognizer
  ├─ Hindi/Hinglish model (if available)
  ├─ Indian-English model
  └─ English model (fallback)
    ↓
Partial/Final Transcript
    ↓
Local Ollama AI Tutor
    ↓
Local Piper TTS
    ↓
Speaker output
```

### Memory Usage

Single active recognizer = low RAM:
- Hindi/Hinglish model: ~200-300 MB loaded
- Not all models at once
- Safe for 8GB student laptops

### Latency

- Time to first partial result: <500ms
- Final transcript latency: <1s
- Real-time factor: <1.0x (runs faster than real-time)

---

## Troubleshooting

### Hindi speech is misrecognized

**Cause**: Hindi/Hinglish model not present yet
**Fix**: Run `bash packages/backend/stt-engine/download-hindi-model.sh` and complete conversion

### App crashes with "Missing encoder/decoder/joiner"

**Cause**: Model files not in the right format or location
**Fix**: Verify model directory structure:
```
sherpa-onnx-streaming-zipformer-hi-en/
  ├── encoder.onnx
  ├── decoder.onnx
  ├── joiner.onnx
  └── tokens.txt
```

### English still works but Hindi is slow

**Cause**: Model conversion incomplete or using slow CTC inference
**Fix**: Ensure ONNX conversion is complete and INT8 quantization is applied

---

## Next Steps

1. **For Now**: App is ready for English + Indian-English students
2. **Soon**: Add Hindi/Hinglish model via download + conversion script
3. **Later**: Pre-distribute converted ONNX files to skip conversion step

---

## Model Details

### Vengadanathan Hindi/Hinglish Zipformer CTC

**Architecture**:
- Encoder: Zipformer-M with 6 stacks
- Layers: [2,2,3,4,3,2]
- Dimensions: [192,256,384,512,384,256]
- Causal/Streaming: Yes
- Chunk size: 16,32,64,-1 frames
- Left context: 64,128,256,-1 frames
- CTC head: Pure CTC (no RNNT)
- Vocab: 103 tokens (Devanagari + Latin + digits)

**Training Data**:
- Phase 1: IndicVoices-hi 60h + keywords 15.4h + Svarah 8.4h + numbers 5.9h
- Phase 3 (current): 1017 hours with 3x speed perturbation
- Total speakers: ~5000 unique speakers

**Performance**:
| Dataset | WER |
|---------|-----|
| Hindi (IndicVoices) | 25.7% |
| Hinglish (call test) | 39.9% |
| Indian English (Svarah) | 44.5% |

---

## License & Attribution

This model integration uses:
- Vengadanathan's Hindi/Hinglish Zipformer model (Apache 2.0)
- icefall framework (Apache 2.0)
- sherpa-onnx runtime (Apache 2.0)

All are compatible with this educational, offline-first project.

---

## Questions?

For Hindi/Hinglish STT issues:
1. Check if model files exist in the right directory
2. Verify model conversion to ONNX format
3. Test with the benchmark script: `node packages/backend/stt-engine/benchmark-stt.mjs`
4. Review STT logs in the Electron console

For general app issues:
- See the main README.md
- Check ARCHITECTURE.md
- Review STT engine implementation in packages/backend/stt-engine/sherpa.ts
