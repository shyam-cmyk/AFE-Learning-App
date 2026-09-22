#!/usr/bin/env bash
# Download Hindi/Hinglish model files from HuggingFace
# Tries multiple sources to find usable ONNX or CTC model files

set -euo pipefail

STT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${STT_DIR}/sherpa-onnx-streaming-zipformer-hi-en"

mkdir -p "$TARGET_DIR"

echo "[Hindi STT] Searching for downloadable ONNX models..."
echo "[Hindi STT] Target: $TARGET_DIR"
echo ""

# Try source 1: Look for files directly in Vengadanathan model
echo "[Hindi STT] Source 1: Checking Vengadanathan repo structure..."
HFURL1="https://huggingface.co/Vengadanathan/hindi-hinglish-zipformer-ctc-streaming/resolve/main"

# List of potential files to try
FILES_TO_TRY=(
    "encoder.onnx"
    "encoder.int8.onnx"
    "decoder.onnx"
    "joiner.onnx"
    "model.onnx"
    "ctc.onnx"
    "ctc-zipformer.onnx"
    "zipformer-encoder.onnx"
)

FOUND_FILES=false

for FILE in "${FILES_TO_TRY[@]}"; do
    if curl -I -f -s "${HFURL1}/${FILE}" > /dev/null 2>&1; then
        echo "[Hindi STT] ✓ Found: $FILE"
        curl -L -# -o "${TARGET_DIR}/${FILE}" "${HFURL1}/${FILE}" || {
            echo "[Hindi STT] ✗ Download failed for $FILE"
            continue
        }
        FOUND_FILES=true
    fi
done

if [ "$FOUND_FILES" = true ]; then
    echo "[Hindi STT]"
    echo "[Hindi STT] ✓ ONNX files downloaded!"
    ls -lh "$TARGET_DIR"/*.onnx 2>/dev/null || true
    exit 0
fi

echo "[Hindi STT] ✗ No ONNX files found in Vengadanathan repo"
echo "[Hindi STT]"
echo "[Hindi STT] The model needs to be converted from PyTorch to ONNX format."
echo "[Hindi STT] This requires Python and the icefall framework."
echo "[Hindi STT]"
echo "[Hindi STT] Option 1: Install Python tools and convert"
echo "[Hindi STT]   pip install torch icefall onnx onnxruntime"
echo "[Hindi STT]   bash convert-hindi-model.sh"
echo "[Hindi STT]"
echo "[Hindi STT] Option 2: Use a pre-converted alternative model"
echo "[Hindi STT]   bash download-hindi-alternative.sh"
echo ""

exit 1
