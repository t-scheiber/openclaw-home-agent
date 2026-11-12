#!/usr/bin/env bash
# Move Cloudflare credentials out of process arguments into root-only env files.

set -euo pipefail

read_args() {
  local pid="$1"
  mapfile -d '' PROCESS_ARGS <"/proc/${pid}/cmdline"
}

arg_after() {
  local wanted="$1"
  local index
  for ((index = 0; index < ${#PROCESS_ARGS[@]}; index++)); do
    if [[ "${PROCESS_ARGS[$index]}" == "$wanted" ]]; then
      printf '%s' "${PROCESS_ARGS[$((index + 1))]}"
      return 0
    fi
  done
  return 1
}

install -d -m 700 /etc/cloudflared

tunnel_pid="$(pgrep -f '^/usr/local/bin/cloudflared --no-autoupdate tunnel run --token ' | head -n1)"
read_args "$tunnel_pid"
tunnel_token="$(arg_after --token)"
umask 077
printf 'TUNNEL_TOKEN=%s\n' "$tunnel_token" >/etc/cloudflared/tunnel-token.env

access_pid="$(pgrep -f '^/usr/local/bin/cloudflared access tcp .*--service-token-id ' | head -n1)"
read_args "$access_pid"
service_id="$(arg_after --service-token-id)"
service_secret="$(arg_after --service-token-secret)"
{
  printf 'TUNNEL_SERVICE_TOKEN_ID=%s\n' "$service_id"
  printf 'TUNNEL_SERVICE_TOKEN_SECRET=%s\n' "$service_secret"
} >/etc/cloudflared/remote-service-token.env

chmod 600 /etc/cloudflared/tunnel-token.env /etc/cloudflared/remote-service-token.env
unset tunnel_token service_id service_secret PROCESS_ARGS

install -d -m 755 /etc/systemd/system/cloudflared.service.d
install -d -m 755 /etc/systemd/system/cf-ssh-remote.service.d
install -m 644 ./cloudflared.service.d/override.conf /etc/systemd/system/cloudflared.service.d/override.conf
install -m 644 ./cf-ssh-remote.service.d/override.conf /etc/systemd/system/cf-ssh-remote.service.d/override.conf
systemctl daemon-reload
systemctl restart cloudflared.service cf-ssh-remote.service

