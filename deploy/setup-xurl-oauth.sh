#!/usr/bin/env bash
# Complete X OAuth2 on the OpenClaw server (headless).
#
# On your Mac (terminal 1 — keep open):
#   ssh openclaw-oauth
#
# On the server (terminal 2, or same session after tunnel is up):
#   eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
#   xurl auth oauth2 --app openclaw example_user
#
# On your Mac browser:
#   http://127.0.0.1:8080
#
# Verify:
#   xurl auth status
#   xurl whoami --auth oauth2

set -euo pipefail
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

echo "Starting X OAuth2 for app 'openclaw' on http://127.0.0.1:8080"
echo "Open http://127.0.0.1:8080 in your Mac browser (requires: ssh openclaw-oauth in another terminal)."
echo

exec xurl auth oauth2 --app openclaw example_user
