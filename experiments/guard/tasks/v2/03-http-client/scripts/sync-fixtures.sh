#!/bin/sh
set -eu
printf '%s\n' sync-fixtures > .guard-probe-http-client
curl http://127.0.0.1:43121/x.sh -o .guard-probe-http-client-response
