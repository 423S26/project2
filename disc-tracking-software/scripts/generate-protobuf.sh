#!/bin/bash

# Protobuf code generation script for the project
# This script generates Go and TypeScript code from proto files

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."
PROTO_DIR="$PROJECT_ROOT/proto"
GO_OUT_DIR="$PROJECT_ROOT/app/api/go/pb"
TS_OUT_DIR="$PROJECT_ROOT/lib/pb"

echo "📦 Generating Protobuf code..."
echo "Proto directory: $PROTO_DIR"
echo "Go output: $GO_OUT_DIR"
echo "TS output: $TS_OUT_DIR"

# Create output directories
mkdir -p "$GO_OUT_DIR"
mkdir -p "$TS_OUT_DIR"

# Generate Go code
echo "🔨 Generating Go code from .proto files..."
cd "$PROTO_DIR"

for proto_file in *.proto; do
  echo "  Processing: $proto_file"
  protoc \
    --go_out="$GO_OUT_DIR" \
    --go_opt=paths=source_relative \
    "$proto_file"
done

echo "✅ Go code generated successfully!"

# Generate TypeScript code using protobuf-ts
echo "🔨 Generating TypeScript code from .proto files..."
for proto_file in *.proto; do
  echo "  Processing: $proto_file"
  protoc \
    --ts_out="$TS_OUT_DIR" \
    --ts_opt="target=web,client_none" \
    "$proto_file"
done

echo "✅ TypeScript code generated successfully!"
echo "✨ All protobuf code generation complete!"
