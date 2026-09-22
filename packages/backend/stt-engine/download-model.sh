#!/usr/bin/env bash
# Download local Sherpa ONNX ASR model bundles into this directory.
# This app intentionally keeps a single streaming recognizer and supports both
# the official Sherpa release bundles and custom Hindi / Hinglish bundles.

set -euo pipefail
STT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
MODEL_NAME_INPUT="${MODEL_NAME:-sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2}"
MODEL_URL="${MODEL_URL:-}"

# Support either an exact archive name or a direct URL.
if [[ "$MODEL_NAME_INPUT" =~ ^https?:// ]]; then
  MODEL_BASENAME="$(basename "$MODEL_NAME_INPUT")"
  URL="$MODEL_NAME_INPUT"
else
  MODEL_BASENAME="$MODEL_NAME_INPUT"
  URL="${MODEL_URL:-${RELEASE_BASE}/${MODEL_NAME_INPUT}}"
fi

TARGET_DIR="$(basename "$MODEL_BASENAME" .tar.bz2)"
TARGET_DIR="${TARGET_DIR%.zip}"

if [ -d "${STT_DIR}/${TARGET_DIR}" ] || [ -d "${STT_DIR}/${TARGET_DIR%.*}" ]; then
  echo "Model already present: ${TARGET_DIR}"
  exit 0
fi

ARCHIVE_PATH="${STT_DIR}/${MODEL_BASENAME}"

mkdir -p "$STT_DIR"
echo "Downloading: ${URL}"
curl -fL --retry 3 --connect-timeout 20 --max-time 600 -o "$ARCHIVE_PATH" "$URL"

echo "Extracting archive: ${ARCHIVE_PATH}"
if [[ "$MODEL_BASENAME" == *.zip ]]; then
  unzip -o "$ARCHIVE_PATH" -d "$STT_DIR"
elif [[ "$MODEL_BASENAME" == *.tar.bz2 || "$MODEL_BASENAME" == *.tbz ]]; then
  tar -xjf "$ARCHIVE_PATH" -C "$STT_DIR"
elif [[ "$MODEL_BASENAME" == *.tar.gz ]]; then
  tar -xzf "$ARCHIVE_PATH" -C "$STT_DIR"
else
  echo "Unknown archive format for ${MODEL_BASENAME}."
  exit 1
fi

rm -f "$ARCHIVE_PATH"

echo "Sherpa model install complete: ${TARGET_DIR}"
