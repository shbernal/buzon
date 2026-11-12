#!/usr/bin/env bash
# Records demo.gif: starts the mock instance, seeds an isolated buzon state, runs the tape.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
export PORT="${PORT:-8788}"

work=$(mktemp -d)
cd "$work"
cp "$here/demo.bashrc" .
mkdir -p bin state/config/buzon state/data/buzon
printf '#!/usr/bin/env bash\nexec bun %q "$@"\n' "$repo/bin/buzon" > bin/buzon
chmod +x bin/buzon
export BUZON_DEMO_BIN="$work/bin"
cat > state/config/buzon/config.toml <<TOML
url = "http://127.0.0.1:$PORT"
domain = "example.com"
TOML
cat > state/data/buzon/registry.json <<'JSON'
{
  "addresses": {
    "lte-2609-github-k3x@example.com": {
      "tier": "lte",
      "site": "github",
      "note": "GitHub, side projects",
      "createdAt": "2026-09-14T10:12:00.000Z",
      "addressId": 12
    },
    "mte-2610-acme-7fd@example.com": {
      "tier": "mte",
      "site": "acme",
      "note": "Acme free trial",
      "createdAt": "2026-10-03T16:40:00.000Z",
      "addressId": 31
    }
  }
}
JSON

BUZON_SITE_PASSWORD=demo bun "$here/mock-server.ts" &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$work"' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done

# buzon names an ste address after the UTC month; the mock pins the random part to 9qa.
sed -e "s/{{ADDRESS}}/ste-$(date -u +%y%m)-9qa/g" -e "s|{{OUTPUT}}|$here/demo.gif|" "$here/demo.tape" > demo.tape
vhs demo.tape
