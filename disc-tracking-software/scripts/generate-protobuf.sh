#!/bin/bash

# Protobuf code generation script for the project
# This script generates Go and TypeScript code from proto files

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
PROTO_DIR="$PROJECT_ROOT/proto"
GO_OUT_DIR="$PROJECT_ROOT/app/api/go/pb"
TS_OUT_DIR="$PROJECT_ROOT/lib/pb"

echo "📦 Generating Protobuf code..."
echo "Proto directory: $PROTO_DIR"
echo "Go output: $GO_OUT_DIR"
echo "TS output: $TS_OUT_DIR"

# Ensure common Go bin path is available for protoc plugins.
if [ -d "$HOME/go/bin" ]; then
  export PATH="$HOME/go/bin:$PATH"
fi

if ! command -v protoc-gen-go >/dev/null 2>&1; then
  echo "❌ protoc-gen-go not found in PATH."
  echo "   Install with: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest"
  exit 1
fi

# Create output directories
mkdir -p "$GO_OUT_DIR"
mkdir -p "$TS_OUT_DIR"

# Generate Go code
echo "🔨 Generating Go code from .proto files..."
cd "$PROTO_DIR"

for proto_file in *.proto; do
  echo "  Processing: $proto_file"
  protoc \
    -I "$PROTO_DIR" \
    --go_out="$GO_OUT_DIR" \
    --go_opt=paths=source_relative \
    "$proto_file"
done

echo "✅ Go code generated successfully!"

# Generate TypeScript code using protobuf-ts
if command -v protoc-gen-ts >/dev/null 2>&1; then
  echo "🔨 Generating TypeScript code from .proto files..."
  for proto_file in *.proto; do
    echo "  Processing: $proto_file"
    protoc \
      -I "$PROTO_DIR" \
      --ts_out="$TS_OUT_DIR" \
      --ts_opt="target=web,client_none" \
      "$proto_file"
  done

  echo "✅ TypeScript code generated successfully!"
else
  echo "⚠️ protoc-gen-ts not found; skipping TypeScript protobuf generation."
  echo "   Install protobuf-ts plugin to enable TS generation."
fi

echo "✨ All protobuf code generation complete!"
