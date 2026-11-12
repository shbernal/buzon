#!/usr/bin/env bash
# Standalone executables for the GitHub release: dist/buzon-<os>-<arch>.tar.gz, each holding
# one `buzon` binary with the Bun runtime inside, and dist/SHA256SUMS.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  mkdir -p "dist/$target"
  bun build --compile --minify --target="bun-$target" src/bin.ts --outfile "dist/$target/buzon"
  tar -czf "dist/buzon-$target.tar.gz" -C "dist/$target" buzon
done
(cd dist && sha256sum buzon-*.tar.gz > SHA256SUMS)
