#!/usr/bin/env bash
# Download and integrate Hindi/Hinglish Streaming Zipformer model
# for real offline Hindi + Hinglish recognition in the AI Tutor app.
#
# This script downloads the Vengadanathan Hindi/Hinglish model
# which is a Zipformer-based streaming model optimized for:
# - Pure Hindi speech
# - Hinglish (Hindi-English code-switching)
# - Mixed language conversations
#
# Model source: https://huggingface.co/Vengadanathan/hindi-hinglish-zipformer-ctc-streaming
# License: Apache 2.0
# Parameters: ~65M, CTC-based, streaming-capable, real-time friendly

set -euo pipefail

echo "[Hindi STT] Starting Hindi/Hinglish model setup..."

STT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_MODEL_DIR="${STT_DIR}/sherpa-onnx-streaming-zipformer-hi-en"

# Check if model already exists
if [ -d "$TARGET_MODEL_DIR" ]; then
    echo "[Hindi STT] ✓ Hindi/Hinglish model already present at: $TARGET_MODEL_DIR"
    exit 0
fi

mkdir -p "$TARGET_MODEL_DIR"

# Download model weights and config from HuggingFace
echo "[Hindi STT] Downloading Hindi/Hinglish Zipformer model from HuggingFace..."
echo "[Hindi STT] This model is ~65M parameters, streaming-capable, CTC-based"
echo "[Hindi STT] Suitable for: Hindi, Hinglish, code-switching speech"

MODEL_BASE_URL="https://huggingface.co/Vengadanathan/hindi-hinglish-zipformer-ctc-streaming/resolve/main"

# Download the PyTorch model checkpoint
CHECKPOINT_FILE="model_p3_epoch15_avg8.pt"
CHECKPOINT_URL="${MODEL_BASE_URL}/${CHECKPOINT_FILE}"

echo "[Hindi STT] Downloading checkpoint: $CHECKPOINT_FILE"
curl -fL --retry 3 --connect-timeout 20 --max-time 900 \
    -o "${TARGET_MODEL_DIR}/${CHECKPOINT_FILE}" \
    "$CHECKPOINT_URL" || {
    echo "[Hindi STT] ✗ Failed to download checkpoint. Check internet and URL."
    rm -rf "$TARGET_MODEL_DIR"
    exit 1
}

# Download vocabulary
TOKENS_FILE="tokens.txt"
TOKENS_URL="${MODEL_BASE_URL}/${TOKENS_FILE}"

echo "[Hindi STT] Downloading vocabulary: $TOKENS_FILE"
curl -fL --retry 3 --connect-timeout 20 \
    -o "${TARGET_MODEL_DIR}/${TOKENS_FILE}" \
    "$TOKENS_URL" || {
    echo "[Hindi STT] ✗ Failed to download vocabulary."
    rm -rf "$TARGET_MODEL_DIR"
    exit 1
}

echo "[Hindi STT] ✓ Model files downloaded successfully"
echo "[Hindi STT] ✓ Model location: $TARGET_MODEL_DIR"
echo "[Hindi STT] Next step: Convert model to ONNX format for sherpa-onnx streaming"
echo "[Hindi STT] Run: pnpm --filter @backend/stt-engine run convert-hindi-model"
