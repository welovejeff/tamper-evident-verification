#!/usr/bin/env bash
# Post-release check: run after pushing a vX.Y.Z tag and letting release.yml finish.
#   scripts/check-release.sh 2.1.1
# Confirms both registries serve the version, the npm exports include every
# browser surface, and a fresh pip install runs the demo outside a clone.
set -euo pipefail
VERSION="${1:?usage: scripts/check-release.sh X.Y.Z}"
fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "PyPI"
pypi=$(curl -fsS "https://pypi.org/pypi/tamper-signal/json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["info"]["version"])')
[ "$pypi" = "$VERSION" ] && ok "latest is $pypi" || bad "latest is $pypi, expected $VERSION"

echo "npm"
npm_json=$(curl -fsS "https://registry.npmjs.org/tamper-signal")
latest=$(printf '%s' "$npm_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["dist-tags"]["latest"])')
[ "$latest" = "$VERSION" ] && ok "latest is $latest" || bad "latest is $latest, expected $VERSION"
for sub in . ./light ./badge ./element ./table ./console ./room ./react ./express; do
  if printf '%s' "$npm_json" | python3 -c "import json,sys;d=json.load(sys.stdin);v=d['versions'].get('$VERSION',{});sys.exit(0 if '$sub' in v.get('exports',{}) else 1)"; then
    ok "exports $sub"
  else
    bad "exports missing $sub"
  fi
done

echo "GitHub release"
if curl -fsS "https://api.github.com/repos/welovejeff/tamper-evident-verification/releases/tags/v$VERSION" >/dev/null; then
  ok "v$VERSION release exists"
else
  bad "no GitHub Release for v$VERSION (create it from the CHANGELOG)"
fi

echo "Fresh install, outside a clone"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
python3 -m venv "$tmp/venv"
"$tmp/venv/bin/pip" install -q "tamper-signal==$VERSION"
if (cd "$tmp" && "$tmp/venv/bin/tamper-signal" demo --no-serve >"$tmp/demo.log" 2>&1); then
  ok "pip install + tamper-signal demo --no-serve"
else
  bad "demo failed; see output below"; tail -20 "$tmp/demo.log"
fi

[ "$fail" = 0 ] && echo "All checks passed." || { echo "Some checks failed."; exit 1; }
