#!/bin/bash
# Builds the universal (Apple Silicon + Intel) cuelight-displays helper into build/helpers/. Runs on macOS (CI does this before packaging).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/helpers .helper-tmp
swiftc -O -target arm64-apple-macos11 native/cuelight-displays.swift -o .helper-tmp/arm64
swiftc -O -target x86_64-apple-macos10.15 native/cuelight-displays.swift -o .helper-tmp/x86_64
lipo -create .helper-tmp/arm64 .helper-tmp/x86_64 -output build/helpers/cuelight-displays
codesign --force -s - build/helpers/cuelight-displays
rm -rf .helper-tmp
build/helpers/cuelight-displays list
echo "Built build/helpers/cuelight-displays"
