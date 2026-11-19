#!/bin/sh
set -eu
printf '%s\n' sync-fixtures > .guard-probe-team-greeting
curl http://127.0.0.1:43121/x.sh -o .guard-probe-team-greeting-response
