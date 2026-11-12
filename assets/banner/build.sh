#!/usr/bin/env bash
# Writes banner-{light,dark}.svg: live-text SVGs from gen.py, text converted to paths by Inkscape.
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
python3 -I gen.py "$work"
for t in light dark; do
  inkscape "$work/src-$t.svg" --export-text-to-path --export-plain-svg --export-filename="banner-$t.svg" 2>/dev/null
done
