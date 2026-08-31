#!/usr/bin/env bash
# Install substack-mcp as a systemd service on a Linux server.
#
# The reason to run it on a server rather than your laptop is scheduled Notes:
# Substack has no native Note scheduling, so this server holds the queue and
# publishes each one when it comes due. On a laptop that only happens while the
# machine is awake. Here it happens on time.
#
# Deliberately isolated so it cannot collide with anything already on the box:
#
#   own user      substackmcp, no login shell, no sudo
#   own directory /var/lib/substack-mcp, mode 700, owned by that user
#   own port      8788 by default, bound to 127.0.0.1 only
#   own service   substack-mcp.service
#
# It binds to loopback, so nothing is exposed to the internet by this script.
# Put it behind your existing reverse proxy, or reach it over an SSH tunnel.
#
# Usage:  sudo bash install.sh --publication example.substack.com [--port 8788]

set -euo pipefail

PORT=8788
PUBLICATION=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --port) PORT="$2"; shift 2 ;;
    --publication) PUBLICATION="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

USER_NAME=substackmcp
DATA_DIR=/var/lib/substack-mcp
ENV_FILE=/etc/substack-mcp.env

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
[[ -n "$PUBLICATION" ]] || { echo "--publication is required, e.g. --publication example.substack.com" >&2; exit 1; }

command -v node >/dev/null || { echo "Node 20 or newer is required and was not found." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || { echo "Node ${NODE_MAJOR} found, 20 or newer is required." >&2; exit 1; }

# Refuse rather than fight for a port something else already holds.
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  echo "port ${PORT} is already in use. Pick another with --port." >&2
  exit 1
fi

echo "==> installing substack-mcp"
npm install -g @thenavidm/substack-mcp >/dev/null
BIN="$(command -v substack-mcp)"

echo "==> creating the service user and data directory"
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
mkdir -p "$DATA_DIR"
chown "$USER_NAME:$USER_NAME" "$DATA_DIR"
chmod 700 "$DATA_DIR"

# The session cookie is full access to the Substack account, so it never goes
# in the unit file, which is world readable. It goes in a 600 environment file
# owned by the service user.
if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="sbmcp_$(head -c32 /dev/urandom | xxd -p -c64)"
  cat > "$ENV_FILE" <<ENV
SUBSTACK_MCP_TOKEN=${TOKEN}
SUBSTACK_MCP_HOME=${DATA_DIR}
SUBSTACK_PUBLICATION_URL=${PUBLICATION}
# Paste the connect.sid cookie value here, then restart the service.
SUBSTACK_SESSION_TOKEN=
ENV
  chmod 600 "$ENV_FILE"
  chown "$USER_NAME:$USER_NAME" "$ENV_FILE"
fi

echo "==> writing the systemd unit"
cat > /etc/systemd/system/substack-mcp.service <<UNIT
[Unit]
Description=Substack MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER_NAME}
Group=${USER_NAME}
EnvironmentFile=${ENV_FILE}
Environment=SUBSTACK_MCP_HOST=127.0.0.1
Environment=SUBSTACK_MCP_PORT=${PORT}
ExecStart=${BIN} --http
Restart=always
RestartSec=5

# Hardening. This process holds a session cookie that is full access to the
# Substack account, so it gets no more of the system than it needs.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable substack-mcp >/dev/null 2>&1 || true

cat <<DONE

Installed. It is NOT running yet, because it needs your Substack session
cookie and that has to come from a signed-in browser.

  1. Get the cookie:

       Open ${PUBLICATION} signed in, then DevTools, Application, Cookies.
       Copy the value of connect.sid. It starts with s%3A.

  2. Put it in the environment file:

       sudo nano ${ENV_FILE}          set SUBSTACK_SESSION_TOKEN=

  3. Start it:

       sudo systemctl start substack-mcp
       sudo -u ${USER_NAME} ${BIN} doctor

  4. Your bearer token, for clients connecting over HTTP:

       sudo grep SUBSTACK_MCP_TOKEN ${ENV_FILE}

It listens on 127.0.0.1:${PORT} only. Nothing is exposed to the internet until
you point a reverse proxy at it.

The cookie expires at around 90 days. When it does, repeat steps 1 and 2 and
restart the service.

DONE
