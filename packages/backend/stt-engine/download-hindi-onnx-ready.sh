#!/usr/bin/env bash
# Download IndicConformer Hindi ONNX model from HuggingFace
# Pre-converted and ready to use with Sherpa-ONNX
# No Python conversion needed

set -euo pipefail

STT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main"

# Choose which variant to download
# Option 1: Pure Hindi (CTC-based)
# Option 2: Hinglish (Encoder-Decoder based, better for mixed language)

VARIANT="${1:-hinglish}"

echo "[Hindi ONNX] Downloading IndicConformer-Sherpa-ONNX"
echo "[Hindi ONNX] Variant: $VARIANT"
echo ""

case "$VARIANT" in
    "hindi")
        echo "[Hindi ONNX] Using pure Hindi model (CTC-based)"
        MODEL_DIR="${STT_DIR}/sherpa-onnx-streaming-zipformer-hi"
        URLS=(
            "${BASE_URL}/hi/model.int8.onnx"
            "${BASE_URL}/tokens.txt"
        )
        FILES=("model.int8.onnx" "tokens.txt")
        ;;
    "hinglish")
        echo "[Hindi ONNX] Using Hinglish model (Hindi + English mixed)"
        MODEL_DIR="${STT_DIR}/sherpa-onnx-streaming-zipformer-hi-en"
        URLS=(
            "${BASE_URL}/hi-hinglish-swift/encoder.int8.onnx"
            "${BASE_URL}/hi-hinglish-swift/decoder.int8.onnx"
            "${BASE_URL}/hi-hinglish-swift/tokens.txt"
        )
        FILES=("encoder.int8.onnx" "decoder.int8.onnx" "tokens.txt")
        ;;
    *)
        echo "[Hindi ONNX] ✗ Unknown variant: $VARIANT"
        echo "[Hindi ONNX] Use: hindi or hinglish"
        exit 1
        ;;
esac

mkdir -p "$MODEL_DIR"
echo "[Hindi ONNX] Target: $MODEL_DIR"
echo ""

# Download files
for i in "${!URLS[@]}"; do
    URL="${URLS[$i]}"
    FILE="${FILES[$i]}"
    FILE_PATH="${MODEL_DIR}/${FILE}"
    
    # Skip if already downloaded
    if [ -f "$FILE_PATH" ]; then
        SIZE=$(du -h "$FILE_PATH" | cut -f1)
        echo "[Hindi ONNX] ✓ Already downloaded: $FILE ($SIZE)"
        continue
    fi
    
    echo "[Hindi ONNX] Downloading $FILE..."
    
    if ! curl -L -# -o "$FILE_PATH" "$URL"; then
        echo "[Hindi ONNX] ✗ Failed to download $FILE"
        rm -f "$FILE_PATH"
        exit 1
    fi
    
    SIZE=$(du -h "$FILE_PATH" | cut -f1)
    echo "[Hindi ONNX] ✓ Downloaded: $FILE ($SIZE)"
done

echo ""
echo "[Hindi ONNX] ✓ All files downloaded successfully!"
echo "[Hindi ONNX] Model location: $MODEL_DIR"
echo ""
echo "[Hindi ONNX] Next steps:"
echo "[Hindi ONNX]   1. pnpm build"
echo "[Hindi ONNX]   2. node packages/backend/stt-engine/benchmark-stt.mjs"
echo "[Hindi ONNX]   3. pnpm --filter desktop dev"
