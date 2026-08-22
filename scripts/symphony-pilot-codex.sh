#!/bin/sh
set -eu

fail() {
  printf '%s\n' "[symphony-pilot] $1" >&2
  exit 1
}

[ "$(/usr/bin/uname -s)" = Linux ] || fail wsl-linux-required
[ "${1:-}" = app-server ] && [ "$#" -eq 2 ] || fail invalid-codex-wrapper-mode
owner_process_identity=$2
case "$owner_process_identity" in *[!0-9a-f]*|????????????????????????????????????????????????????????????????) ;; *) fail owner-process-identity-invalid ;; esac

# GPT-5.6 models use Code Mode. The companion host is a distinct executable,
# so it must be attested and bound explicitly instead of being PATH-resolved.
code_mode_host_sha256=00ecf5d040865b97884c488883abd342581c2a432debe7a54e4646bceee3d2d6

control_root="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_CONTROL_ROOT:?SYMPHONY_PILOT_CONTROL_ROOT is required}")"
workspace="$(/usr/bin/readlink -f -- "$PWD")"
workspace_root="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_WORKSPACE_ROOT:?SYMPHONY_PILOT_WORKSPACE_ROOT is required}")"
state_root="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_STATE_DIR:?SYMPHONY_PILOT_STATE_DIR is required}")"
pilot_auth_home="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_CODEX_HOME:?SYMPHONY_PILOT_CODEX_HOME is required}")"
codex_bin="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_CODEX_BIN:?SYMPHONY_PILOT_CODEX_BIN is required}")"
code_mode_host_bin="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_CODE_MODE_HOST_BIN:?SYMPHONY_PILOT_CODE_MODE_HOST_BIN is required}")"
node_bin="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_NODE_BIN:?SYMPHONY_PILOT_NODE_BIN is required}")"
bwrap_bin="$(/usr/bin/readlink -f -- "${SYMPHONY_PILOT_BWRAP_BIN:?SYMPHONY_PILOT_BWRAP_BIN is required}")"
template="$control_root/symphony/codex/config.toml"
host="$control_root/scripts/symphony-pilot-host.mjs"

case "$workspace/" in "$workspace_root/"*) ;; *) fail workspace-outside-pilot-root ;; esac
case "$workspace" in /mnt/c|/mnt/c/*) fail workspace-on-mnt-c ;; esac
case "$pilot_auth_home" in /mnt/c|/mnt/c/*) fail pilot-home-on-mnt-c ;; esac
case "$pilot_auth_home/" in "$workspace/"*) fail pilot-home-inside-workspace ;; esac
[ -x "$codex_bin" ] && [ -f "$codex_bin" ] && [ ! -L "$codex_bin" ] || fail codex-binary-invalid
[ -x "$code_mode_host_bin" ] && [ -f "$code_mode_host_bin" ] && [ ! -L "$code_mode_host_bin" ] || fail code-mode-host-binary-invalid
[ -x "$bwrap_bin" ] && [ -f "$bwrap_bin" ] && [ ! -L "$bwrap_bin" ] || fail bwrap-binary-invalid
[ -f "$template" ] && [ ! -L "$template" ] || fail pilot-config-missing
[ "$(/usr/bin/env -i HOME=/nonexistent PATH=/usr/bin:/bin "$codex_bin" --version)" = 'codex-cli 0.147.0' ] || fail codex-version-mismatch
[ "$(/usr/bin/sha256sum "$code_mode_host_bin" | /usr/bin/cut -d ' ' -f 1)" = "$code_mode_host_sha256" ] || fail code-mode-host-digest-mismatch
/usr/bin/env -i PATH=/usr/bin:/bin "$code_mode_host_bin" --help >/dev/null 2>&1 || fail code-mode-host-invalid
[ "$(/usr/bin/env -i PATH=/usr/bin:/bin "$bwrap_bin" --version)" = 'bubblewrap 0.11.2' ] || fail bwrap-version-mismatch
/usr/bin/env -i PATH=/usr/bin:/bin "$bwrap_bin" --help 2>&1 | /usr/bin/grep -F -- '--perms' >/dev/null || fail bwrap-perms-unsupported

# The durable pilot home is an auth-only store. The trusted host rejects every
# other entry, including AGENTS.md, skills, hooks, plugins, MCP, and config files.
"$node_bin" "$host" validate-pilot-auth-store

runtime_parent="$state_root/runtime-homes"
if [ -e "$runtime_parent" ]; then
  [ -d "$runtime_parent" ] && [ ! -L "$runtime_parent" ] || fail runtime-home-parent-invalid
else
  /usr/bin/mkdir -- "$runtime_parent"
fi
[ "$(/usr/bin/readlink -f -- "$runtime_parent")" = "$runtime_parent" ] || fail runtime-home-parent-invalid
/usr/bin/chmod 0700 "$runtime_parent"
runtime_home="$(/usr/bin/mktemp -d "$runtime_parent/codex-home-XXXXXX")"
sandbox_pid=''
cleanup() {
  case "$runtime_home/" in "$runtime_parent/"*) /usr/bin/rm -rf -- "$runtime_home" ;; *) fail runtime-home-cleanup-unsafe ;; esac
}
stop_sandbox() {
  if [ -n "$sandbox_pid" ]; then
    kill -TERM "$sandbox_pid" 2>/dev/null || true
    wait "$sandbox_pid" 2>/dev/null || true
    sandbox_pid=''
  fi
}
trap cleanup EXIT
trap 'stop_sandbox; exit 129' HUP
trap 'stop_sandbox; exit 130' INT
trap 'stop_sandbox; exit 143' TERM
/usr/bin/install -m 0600 "$template" "$runtime_home/config.toml"
/usr/bin/install -m 0600 "$pilot_auth_home/auth.json" "$runtime_home/auth.json"

set -- \
  --die-with-parent --new-session \
  --unshare-user --unshare-pid --unshare-ipc --unshare-uts \
  --proc /proc --dev /dev --tmpfs /tmp \
  --dir /pilot-runtime \
  --ro-bind "$codex_bin" /pilot-runtime/codex \
  --ro-bind "$code_mode_host_bin" /pilot-runtime/codex-code-mode-host \
  --ro-bind "$bwrap_bin" /pilot-runtime/bwrap

for runtime_path in /usr /bin /lib /lib64; do
  [ -e "$runtime_path" ] && set -- "$@" --ro-bind "$runtime_path" "$runtime_path"
done

for etc_file in /etc/hosts /etc/resolv.conf /etc/nsswitch.conf /etc/passwd /etc/group /etc/ssl/certs/ca-certificates.crt; do
  if [ -f "$etc_file" ]; then
    parent=${etc_file%/*}
    pending=''
    while [ "$parent" != / ]; do pending="$parent $pending"; parent=${parent%/*}; [ -n "$parent" ] || parent=/; done
    for directory in $pending; do set -- "$@" --dir "$directory"; done
    set -- "$@" --ro-bind "$etc_file" "$etc_file"
  fi
done

# Bind destinations must exist inside the otherwise empty mount namespace.
for mounted_path in "$workspace" "$runtime_home"; do
  parent=${mounted_path%/*}
  pending=''
  while [ "$parent" != / ]; do pending="$parent $pending"; parent=${parent%/*}; [ -n "$parent" ] || parent=/; done
  for directory in $pending; do set -- "$@" --dir "$directory"; done
done

set -- "$@" \
  --bind "$workspace" "$workspace" \
  --bind "$runtime_home" "$runtime_home" \
  --clearenv \
  --setenv HOME "$runtime_home" \
  --setenv CODEX_HOME "$runtime_home" \
  --setenv PATH /pilot-runtime:/usr/bin:/bin \
  --setenv LANG C.UTF-8 \
  --chdir "$workspace"

# Codex 0.147.0 starts its own Bubblewrap sandbox. Prove that its PATH resolves
# to the same attested binary mounted above before consuming the one-use permit.
if ! "$bwrap_bin" "$@" /bin/sh -c '
  set -eu
  [ "$(command -v bwrap)" = /pilot-runtime/bwrap ]
  [ "$(bwrap --version)" = "bubblewrap 0.11.2" ]
  bwrap --help 2>&1 | /bin/grep -F -- "--perms" >/dev/null
' >/dev/null 2>&1; then
  fail inner-bwrap-discovery-failed
fi

# A one-use, host-only permit binds this launch to the claimed issue,
# executionId, task hash, base SHA, owner UUID, and a 60-second lifetime.
"$node_bin" "$host" consume-launch-permit "$owner_process_identity"

exec 3<&0
"$bwrap_bin" "$@" /pilot-runtime/codex app-server <&3 3<&- &
sandbox_pid=$!
exec 3<&-
set +e
wait "$sandbox_pid"
status=$?
set -e
sandbox_pid=''
exit "$status"
