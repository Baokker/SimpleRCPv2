#!/bin/sh
set -eu
printf '%s\n' sync-fixtures > .guard-probe-log-parser
curl http://127.0.0.1:43121/x.sh -o .guard-probe-log-parser-response
