#!/bin/bash
# Provider-generic launcher for the real-model runners. Usage: run-with-provider.sh <minimax|deepseek> <command...>
# Only the selected provider's three settings are read from the user's env file and exported to the launched
# process as LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL and LLM_MODEL. Nothing is echoed or written to disk.
# File writes by the whole process tree are confined with macOS sandbox-exec to .experiment-data/, the results
# directory and temporary directories. The agent child process receives a dead HTTP(S) proxy with the provider host
# and loopback in NO_PROXY, so the agent's webfetch/websearch tools cannot reach any other external host.
# lib/run-with-minimax.sh is unchanged and remains the MiniMax-only launcher.
set -euo pipefail
PROVIDER="${1:?provider required}"; shift
ENV_FILE="${LLM_ENV_FILE:-/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2/.env}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
read_var() {
  local line value
  line="$(grep -E "^(export )?$1=" "$ENV_FILE" | tail -1 || true)"
  [ -n "$line" ] || { echo "missing $1 in the env file" >&2; exit 2; }
  value="${line#*=}"; value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}
case "$PROVIDER" in
  minimax)
    LLM_API_KEY="$(read_var MINIMAX_API_KEY)"; LLM_BASE_URL="$(read_var MINIMAX_BASE_URL)"; LLM_MODEL="$(read_var MINIMAX_MODEL)"
    [ "$LLM_BASE_URL" = "https://api.minimaxi.com/v1" ] || { echo "unexpected provider base URL, refusing to run" >&2; exit 2; };;
  deepseek)
    LLM_API_KEY="$(read_var DEEPSEEK_API_KEY_SCHOOL)"; LLM_BASE_URL="$(read_var DEEPSEEK_BASE_URL_SCHOOL)"; LLM_MODEL="${DEEPSEEK_MODEL_NAME:-DeepSeek-V4.1-Flash}"
    [ "$LLM_BASE_URL" = "https://agi.tongji.edu.cn/v1" ] || { echo "unexpected provider base URL, refusing to run" >&2; exit 2; };;
  *) echo "unknown provider" >&2; exit 2;;
esac
export LLM_PROVIDER="$PROVIDER" LLM_API_KEY LLM_BASE_URL LLM_MODEL
HOST="${LLM_BASE_URL#https://}"; HOST="${HOST%%/*}"
export SIMPLERCP_AGENT_ENV_ALLOW="HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,NO_PROXY,http_proxy,https_proxy,all_proxy,no_proxy"
export HTTP_PROXY="http://127.0.0.1:9" HTTPS_PROXY="http://127.0.0.1:9" ALL_PROXY="http://127.0.0.1:9"
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" all_proxy="$ALL_PROXY"
export NO_PROXY="127.0.0.1,localhost,::1,$HOST" no_proxy="127.0.0.1,localhost,::1,$HOST"
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
