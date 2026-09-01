#!/usr/bin/env bash
# Build substack-mcp from source and register it with Claude Code.
#
# For people who would rather not wait for the npm release, or who want to run
# a local checkout. Everything it does is one of the commands in README §12.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v node >/dev/null || { echo "node 20+ is required"; exit 1; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 20 ] || { echo "node 20+ is required, found $(node -v)"; exit 1; }

echo "==> installing dependencies"
( cd "$here" && npm ci --silent )

echo "==> building"
( cd "$here" && npm run build --silent )

echo "==> running tests"
( cd "$here" && npm test --silent )

if ! command -v claude >/dev/null; then
  echo
  echo "Built. Point your MCP client at:"
  echo "  node $here/dist/index.js"
  exit 0
fi

: "${SUBSTACK_PUBLICATION_URL:=}"
: "${SUBSTACK_SESSION_TOKEN:=}"

if [ -z "$SUBSTACK_PUBLICATION_URL" ] || [ -z "$SUBSTACK_SESSION_TOKEN" ]; then
  echo
  echo "Set SUBSTACK_PUBLICATION_URL and SUBSTACK_SESSION_TOKEN, then re-run to"
  echo "register with Claude Code automatically."
  echo
  echo "The token is your connect.sid cookie. Sign in to your publication, then"
  echo "DevTools, Application, Cookies, and copy the value of connect.sid."
  echo "Use the canonical yourname.substack.com host, not a custom domain."
  echo
  echo "Or capture it interactively:"
  echo "  node $here/dist/index.js login"
  echo
  echo "Or register it yourself:"
  echo "  claude mcp add substack -- node $here/dist/index.js"
  exit 0
fi

echo "==> registering with Claude Code"
claude mcp remove substack 2>/dev/null || true
claude mcp add substack \
  -e "SUBSTACK_PUBLICATION_URL=$SUBSTACK_PUBLICATION_URL" \
  -e "SUBSTACK_SESSION_TOKEN=$SUBSTACK_SESSION_TOKEN" \
  -- node "$here/dist/index.js"

echo
echo "==> checking the setup"
SUBSTACK_PUBLICATION_URL="$SUBSTACK_PUBLICATION_URL" SUBSTACK_SESSION_TOKEN="$SUBSTACK_SESSION_TOKEN" \
  node "$here/dist/index.js" doctor
