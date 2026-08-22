#!/bin/sh
set -eu

bootstrap_state_ready=0
state_root=''
workspace=''
owner_instance_id=''

persist_bootstrap_block() {
  [ "$bootstrap_state_ready" = 1 ] || return 0
  issue_name=${workspace##*/}
  case "$issue_name" in GH-[1-9]*[!0-9]*|GH-|*[!A-Za-z0-9-]*) return 0 ;; esac
  issue_number=${issue_name#GH-}
  case "$issue_number" in ''|*[!0-9]*) return 0 ;; esac
  locks="$state_root/locks"
  if [ ! -e "$locks" ]; then /usr/bin/mkdir -- "$locks" 2>/dev/null || return 0; /usr/bin/chmod 0700 "$locks" || return 0; fi
  [ -d "$locks" ] && [ ! -L "$locks" ] || return 0
  [ "$(/usr/bin/readlink -f -- "$locks")" = "$locks" ] || return 0
  coordination="$locks/GH-$issue_number.coordination.lock"
  /usr/bin/mkdir -- "$coordination" 2>/dev/null || return 0
  state_file="$state_root/GH-$issue_number.json"
  if [ ! -e "$state_file" ]; then
    temporary="$state_file.launcher-$$.tmp"
    umask 077
    (set -C; printf '%s\n' "{\"schemaVersion\":3,\"state\":\"blocked\",\"issueNumber\":$issue_number,\"executionId\":0,\"taskHash\":null,\"baseSha\":null,\"branchName\":\"codex/gh-$issue_number\",\"ownerInstanceId\":\"$owner_instance_id\",\"blockerCode\":\"repository-state-conflict\"}" >"$temporary") 2>/dev/null || true
    [ -f "$temporary" ] && /usr/bin/mv -- "$temporary" "$state_file" 2>/dev/null || true
  fi
  /usr/bin/rmdir -- "$coordination" 2>/dev/null || true
  return 0
}

fail() {
  persist_bootstrap_block
  printf '%s\n' "[symphony-pilot] $1" >&2
  exit 1
}

canonical() {
  [ -n "$1" ] || fail trusted-path-missing
  [ "$1" = "${1#/}" ] && fail trusted-path-not-absolute
  resolved="$(/usr/bin/readlink -f -- "$1")" || fail trusted-path-invalid
  [ "$resolved" = "$1" ] || fail trusted-path-not-canonical
  printf '%s\n' "$resolved"
}

assert_not_writable() {
  metadata="$(/usr/bin/stat -Lc '%u %A' -- "$1")" || fail trusted-path-stat-failed
  owner=${metadata%% *}
  permissions=${metadata#* }
  [ "$owner" = 0 ] || fail trusted-path-owner-invalid
  [ "$(printf '%s' "$permissions" | /usr/bin/cut -c 6)" != w ] || fail trusted-path-writable
  [ "$(printf '%s' "$permissions" | /usr/bin/cut -c 9)" != w ] || fail trusted-path-writable
}

assert_trusted_ancestors() {
  current=$1
  [ -d "$current" ] || current=${current%/*}
  while :; do
    assert_not_writable "$current"
    [ "$current" = / ] && break
    current=${current%/*}
    [ -n "$current" ] || current=/
  done
}

assert_private_directory() {
  [ -d "$1" ] && [ ! -L "$1" ] || fail pilot-directory-invalid
  metadata="$(/usr/bin/stat -Lc '%u %A' -- "$1")" || fail trusted-path-stat-failed
  owner=${metadata%% *}
  permissions=${metadata#* }
  [ "$owner" = "$(/usr/bin/id -u)" ] || fail pilot-directory-owner-invalid
  [ "$(printf '%s' "$permissions" | /usr/bin/cut -c 6)" != w ] || fail pilot-directory-writable
  [ "$(printf '%s' "$permissions" | /usr/bin/cut -c 9)" != w ] || fail pilot-directory-writable
}

overlap() {
  case "$1/" in "$2/"*) return 0 ;; esac
  case "$2/" in "$1/"*) return 0 ;; esac
  return 1
}

[ "$(/usr/bin/uname -s)" = Linux ] || fail wsl-linux-required
state_root="$(canonical "${SYMPHONY_PILOT_STATE_DIR:-}")"
workspace_root="$(canonical "${SYMPHONY_PILOT_WORKSPACE_ROOT:-}")"
workspace="$(canonical "$PWD")"
owner_instance_id=${SYMPHONY_PILOT_INSTANCE_ID:-}
assert_private_directory "$state_root"
assert_private_directory "$workspace_root"
case "$workspace/" in "$workspace_root/"*) ;; *) fail workspace-outside-pilot-root ;; esac
case "$owner_instance_id" in *[!0-9a-f-]*) fail invalid-instance-id ;; esac
case "$owner_instance_id" in ????????-????-[1-5]???-[89ab]???-????????????) ;; *) fail invalid-instance-id ;; esac
bootstrap_state_ready=1

[ "$#" -ge 2 ] || fail invalid-launcher-mode
case "$1:$2:$#" in host:prepare:2|host:finalize:2|host:operator-block:4|codex:app-server:2) ;; *) fail invalid-launcher-mode ;; esac

control_root="$(canonical "${SYMPHONY_PILOT_CONTROL_ROOT:-}")"
launcher="$(canonical "${SYMPHONY_PILOT_TRUSTED_LAUNCHER:-}")"
node_bin="$(canonical "${SYMPHONY_PILOT_NODE_BIN:-}")"
pilot_auth_home="$(canonical "${SYMPHONY_PILOT_CODEX_HOME:-}")"

[ -d "$control_root" ] && [ ! -L "$control_root" ] || fail control-root-invalid
[ -f "$launcher" ] && [ -x "$launcher" ] && [ ! -L "$launcher" ] || fail trusted-launcher-invalid
[ -f "$node_bin" ] && [ -x "$node_bin" ] && [ ! -L "$node_bin" ] || fail trusted-node-invalid
assert_trusted_ancestors "$control_root"
assert_trusted_ancestors "$launcher"
assert_trusted_ancestors "$node_bin"
assert_private_directory "$pilot_auth_home"

overlap "$control_root" "$workspace_root" && fail trusted-path-overlap
overlap "$control_root" "$workspace" && fail trusted-path-overlap
overlap "$control_root" "$state_root" && fail trusted-path-overlap
overlap "$state_root" "$workspace_root" && fail trusted-path-overlap
overlap "$pilot_auth_home" "$workspace_root" && fail pilot-auth-path-overlap
overlap "$pilot_auth_home" "$workspace" && fail pilot-auth-path-overlap
overlap "$pilot_auth_home" "$control_root" && fail pilot-auth-path-overlap

manifest="$control_root/symphony/control-manifest.sha256"
[ -f "$manifest" ] && [ ! -L "$manifest" ] || fail control-manifest-invalid
assert_not_writable "$manifest"
(
  cd "$control_root"
  /usr/bin/sha256sum --strict --check symphony/control-manifest.sha256 >/dev/null
) || fail control-file-digest-mismatch
control_launcher="$control_root/scripts/symphony-pilot-trusted-launcher.sh"
launcher_hash="$(/usr/bin/sha256sum "$launcher" | /usr/bin/cut -d ' ' -f 1)"
control_launcher_hash="$(/usr/bin/sha256sum "$control_launcher" | /usr/bin/cut -d ' ' -f 1)"
[ "$launcher_hash" = "$control_launcher_hash" ] || fail trusted-launcher-integrity-failed

PATH=/usr/bin:/bin
export PATH
unset BASH_ENV ENV CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_CONFIG GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM
unset GIT_EXEC_PATH LD_PRELOAD LD_LIBRARY_PATH NODE_OPTIONS NPM_CONFIG_USERCONFIG

case "$1:$2" in
  host:prepare|host:finalize)
    exec "$node_bin" "$control_root/scripts/symphony-pilot-host.mjs" "$2"
    ;;
  host:operator-block)
    exec "$node_bin" "$control_root/scripts/symphony-pilot-host.mjs" operator-block "$3" "$4"
    ;;
  codex:app-server)
    exec "$control_root/scripts/symphony-pilot-codex.sh" app-server
    ;;
  *) fail invalid-launcher-mode ;;
esac
