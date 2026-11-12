#!/usr/bin/env bash
# Writes how-it-works-{light,dark}.svg: live-text SVGs from build.py, text converted to paths by Inkscape.
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
python3 -I build.py "$work"
for t in light dark; do
  inkscape "$work/how-it-works-$t.src.svg" --export-text-to-path --export-plain-svg --export-filename="how-it-works-$t.svg" 2>/dev/null
done
