#!/usr/bin/env bash
# Download Hindi ONNX model for Sherpa-ONNX
# This model is pre-converted and ready to use immediately
# No Python conversion required

set -euo pipefail

STT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL_URL="https://huggingface.co/parismitaglobalsolutions/indicconformer_hindi_onnx/resolve/main"
MODEL_NAME="indicconformer_hindi_onnx"
TARGET_DIR="${STT_DIR}/sherpa-onnx-streaming-zipformer-hi-en"

echo "[Hindi STT] Downloading ONNX-ready Hindi model..."
echo "[Hindi STT] This model is pre-converted and ready to use immediately"
echo "[Hindi STT] Target: $TARGET_DIR"

# Create target directory
mkdir -p "$TARGET_DIR"

# Files to download
declare -a FILES=(
    "encoder.onnx"
    "decoder.onnx"
    "joiner.onnx"
    "tokens.txt"
)

# Download each file
for FILE in "${FILES[@]}"; do
    FILE_PATH="${TARGET_DIR}/${FILE}"
    
    if [ -f "$FILE_PATH" ]; then
        echo "[Hindi STT] ✓ Already downloaded: $FILE"
        continue
    fi
    
    echo "[Hindi STT] Downloading $FILE..."
    
    if ! curl -L -f -o "$FILE_PATH" "${MODEL_URL}/${FILE}" 2>/dev/null; then
        echo "[Hindi STT] ✗ Failed to download $FILE"
        
        # Try alternative source
        echo "[Hindi STT] Trying alternative source..."
        ALT_URL="https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/hindi"
        
        if curl -L -f -o "$FILE_PATH" "${ALT_URL}/${FILE}" 2>/dev/null; then
            echo "[Hindi STT] ✓ Downloaded from alternative source: $FILE"
        else
            echo "[Hindi STT] ✗ Could not download $FILE from either source"
            rm -f "$FILE_PATH"
            exit 1
        fi
    else
        echo "[Hindi STT] ✓ Downloaded: $FILE"
    fi
done

echo "[Hindi STT]"
echo "[Hindi STT] ✓ Hindi ONNX model ready!"
echo "[Hindi STT] ✓ Location: $TARGET_DIR"
echo "[Hindi STT]"
echo "[Hindi STT] Next step: Run 'pnpm build && node benchmark-stt.mjs'"
