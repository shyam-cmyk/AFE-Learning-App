#!/usr/bin/env bash
# Download official Sherpa ONNX ASR model bundles into this directory.
# This app is intentionally Sherpa-only and uses the official release bundles.

set -euo pipefail
STT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
MODEL="${MODEL_NAME:-sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2}"
TARGET_DIR="$(basename "$MODEL" .tar.bz2)"

if [ -d "${STT_DIR}/${TARGET_DIR}" ] || [ -d "${STT_DIR}/${TARGET_DIR%.*}" ]; then
  echo "Model already present: ${TARGET_DIR}"
  exit 0
fi

ARCHIVE_PATH="${STT_DIR}/${MODEL}"
URL="${RELEASE_BASE}/${MODEL}"

echo "Downloading: ${URL}"
curl -fL --retry 3 --connect-timeout 20 --max-time 300 -o "$ARCHIVE_PATH" "$URL"

echo "Extracting archive: ${ARCHIVE_PATH}"
mkdir -p "$STT_DIR"
if command -v tar >/dev/null 2>&1; then
  tar -xjf "$ARCHIVE_PATH" -C "$STT_DIR"
else
  echo "tar is required to extract the model archive."
  exit 1
fi

rm -f "$ARCHIVE_PATH"

echo "Sherpa model install complete: ${TARGET_DIR}"
