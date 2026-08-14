#!/usr/bin/env bash
# Start Metro advertising this machine's tailnet IP, so the phone (which is not on
# the laptop's wifi) can reach the bundler. The IP is looked up rather than pinned:
# tailnet addresses change when a machine is re-added to the tailnet, and a stale
# constant here shows up as a QR scan that times out with no explanation.
set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  echo "start:tailnet: tailscale CLI not found — is Tailscale installed?" >&2
  exit 1
fi

ip="$(tailscale ip -4 2>/dev/null | head -n 1)"

if [ -z "$ip" ]; then
  echo "start:tailnet: no IPv4 tailnet address — is tailscaled up? (tailscale status)" >&2
  exit 1
fi

echo "start:tailnet: advertising Metro on $ip" >&2
exec env REACT_NATIVE_PACKAGER_HOSTNAME="$ip" npx expo start --port 8082 "$@"
