#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "[symphony-pilot] $1" >&2
  exit 1
}

[[ "$(uname -s)" == Linux ]] || fail wsl-linux-required
[[ "${1:-}" == app-server && "$#" -eq 1 ]] || fail invalid-codex-wrapper-mode
command -v bwrap >/dev/null 2>&1 || fail bwrap-missing
command -v realpath >/dev/null 2>&1 || fail realpath-missing

control_root="$(realpath "${SYMPHONY_PILOT_CONTROL_ROOT:?SYMPHONY_PILOT_CONTROL_ROOT is required}")"
workspace="$(realpath "$PWD")"
workspace_root="$(realpath "${SYMPHONY_PILOT_WORKSPACE_ROOT:?SYMPHONY_PILOT_WORKSPACE_ROOT is required}")"
pilot_home="$(realpath "${SYMPHONY_PILOT_CODEX_HOME:?SYMPHONY_PILOT_CODEX_HOME is required}")"
codex_bin="$(realpath "${SYMPHONY_PILOT_CODEX_BIN:?SYMPHONY_PILOT_CODEX_BIN is required}")"
template="$control_root/symphony/codex/config.toml"

case "$workspace/" in "$workspace_root/"*) ;; *) fail workspace-outside-pilot-root ;; esac
case "$workspace" in /mnt/c|/mnt/c/*) fail workspace-on-mnt-c ;; esac
case "$pilot_home" in /mnt/c|/mnt/c/*) fail pilot-home-on-mnt-c ;; esac
case "$pilot_home/" in "$workspace/"*) fail pilot-home-inside-workspace ;; esac
[[ -x "$codex_bin" && -f "$codex_bin" ]] || fail codex-binary-invalid
[[ -f "$pilot_home/config.toml" && ! -L "$pilot_home/config.toml" ]] || fail pilot-config-missing
cmp -s "$template" "$pilot_home/config.toml" || fail pilot-config-mismatch
[[ "$($codex_bin --version)" == 'codex-cli 0.147.0' ]] || fail codex-version-mismatch

declare -a args=(
  --die-with-parent --new-session
  --unshare-user --unshare-pid --unshare-ipc --unshare-uts
  --proc /proc --dev /dev --tmpfs /tmp
  --dir /pilot-runtime
  --ro-bind "$codex_bin" /pilot-runtime/codex
)

for runtime_path in /usr /bin /lib /lib64; do
  [[ -e "$runtime_path" ]] && args+=(--ro-bind "$runtime_path" "$runtime_path")
done

for etc_file in /etc/hosts /etc/resolv.conf /etc/nsswitch.conf /etc/passwd /etc/group /etc/ssl/certs/ca-certificates.crt; do
  if [[ -f "$etc_file" ]]; then
    parent="$(dirname "$etc_file")"
    while [[ "$parent" != / ]]; do args+=(--dir "$parent"); parent="$(dirname "$parent")"; done
    args+=(--ro-bind "$etc_file" "$etc_file")
  fi
done

add_parent_dirs() {
  local current parent
  current="$(dirname "$1")"
  declare -a pending=()
  while [[ "$current" != / ]]; do pending+=("$current"); current="$(dirname "$current")"; done
  for (( parent=${#pending[@]}-1; parent>=0; parent-- )); do args+=(--dir "${pending[$parent]}"); done
}

add_parent_dirs "$workspace"
add_parent_dirs "$pilot_home"
args+=(
  --bind "$workspace" "$workspace"
  --bind "$pilot_home" "$pilot_home"
  --clearenv
  --setenv HOME "$pilot_home"
  --setenv CODEX_HOME "$pilot_home"
  --setenv PATH /pilot-runtime:/usr/bin:/bin
  --setenv LANG C.UTF-8
  --chdir "$workspace"
)

exec bwrap "${args[@]}" /pilot-runtime/codex app-server
