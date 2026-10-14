#!/usr/bin/env bash
# Free, local speech-to-text for Ambient Builder via whisper.cpp.
# Usage: npm run whisper:setup   (then: npm run whisper, in its own terminal)
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${WHISPER_MODEL:-base.en}"   # base.en is fast; small.en is more accurate but slower
mkdir -p models

if ! command -v whisper-server >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing whisper.cpp with Homebrew…"
    brew install whisper-cpp
  else
    echo "Please install whisper.cpp so that 'whisper-server' is on your PATH:"
    echo "  https://github.com/ggml-org/whisper.cpp#quick-start  (build it, then add build/bin to PATH)"
    exit 1
  fi
fi

if [ ! -f "models/ggml-$MODEL.bin" ]; then
  echo "Downloading the $MODEL model…"
  curl -L --fail -o "models/ggml-$MODEL.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
fi
echo "Ready. Start it with: npm run whisper"
