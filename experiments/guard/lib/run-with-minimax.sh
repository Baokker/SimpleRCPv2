#!/bin/bash
# Run a command with only MINIMAX_API_KEY, MINIMAX_BASE_URL and MINIMAX_MODEL loaded from the user's MiniMax .env.
# The values live in the environment of the launched process only. Nothing is echoed or written to disk.
# File writes by the whole process tree are confined with macOS sandbox-exec to .experiment-data/, the results
# directory and temporary directories, so a model-chosen shell command cannot modify anything else.
set -euo pipefail
ENV_FILE="${MINIMAX_ENV_FILE:-/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2/.env}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
for name in MINIMAX_API_KEY MINIMAX_BASE_URL MINIMAX_MODEL; do
  line="$(grep -E "^(export )?${name}=" "$ENV_FILE" | tail -1 || true)"
  [ -n "$line" ] || { echo "missing ${name} in the MiniMax env file" >&2; exit 2; }
  value="${line#*=}"; value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  export "${name}=${value}"
done
case "$MINIMAX_BASE_URL" in https://api.minimaxi.com/v1) ;; *) echo "unexpected provider base URL, refusing to run" >&2; exit 2;; esac
if [ "${NO_SANDBOX:-0}" = "1" ]; then exec "$@"; fi
PROFILE="$(mktemp "${TMPDIR:-/tmp}/guard-sandbox.XXXXXX")"
trap 'rm -f "$PROFILE"' EXIT
cat > "$PROFILE" <<PROFILE_EOF
(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath "$ROOT/.experiment-data")
  (subpath "$ROOT/experiments/guard/results-compact")
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "/dev"))
PROFILE_EOF
sandbox-exec -f "$PROFILE" "$@"
