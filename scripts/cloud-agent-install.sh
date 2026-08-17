#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

install_pkg() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    echo "skip missing $dir"
    return 0
  fi
  if [[ -f "$dir/package-lock.json" ]]; then
    (cd "$dir" && npm ci)
  else
    (cd "$dir" && npm install)
  fi
}

install_pkg "$root/cat-mouse"
install_pkg "$root/agi"
echo "cloud-agent-install complete"
