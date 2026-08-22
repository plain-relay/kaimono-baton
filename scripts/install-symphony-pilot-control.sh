#!/bin/sh
set -eu

fail() {
  printf '%s\n' "[symphony-pilot-install] $1" >&2
  exit 1
}

[ "$(/usr/bin/id -u)" = 0 ] || fail root-required-run-explicitly
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || fail 'usage: install-symphony-pilot-control.sh SOURCE_ROOT VERSION_OR_SHA CLEAN_SYMPHONY_SOURCE_ROOT [LAUNCHER_PATH]'

source_root="$(/usr/bin/readlink -f -- "$1")"
version=$2
symphony_source_root="$(/usr/bin/readlink -f -- "$3")"
launcher_path=${4:-/opt/plain-relay/kaimono-baton-symphony-launcher}
case "$version" in *[!A-Za-z0-9._-]*|'') fail invalid-version ;; esac
case "$version" in .|..) fail invalid-version ;; esac
destination="/opt/plain-relay/kaimono-baton-symphony-control/$version"
symphony_sha=8001b52e3062495a16e520e4ceaf8f9de868c4d0
symphony_destination=/opt/plain-relay/openai-symphony-8001b52e
[ ! -e "$destination" ] || fail destination-already-exists
[ ! -e "$symphony_destination" ] || fail symphony-destination-already-exists
case "$launcher_path" in /*) ;; *) fail launcher-path-not-absolute ;; esac
case "$launcher_path/" in "$destination/"*) fail launcher-inside-control-root ;; esac

git_bin=${SYMPHONY_PILOT_GIT_BIN:-/opt/git-2.50.1/bin/git}
git_exec_path=${SYMPHONY_PILOT_GIT_EXEC_PATH:-/opt/git-2.50.1/libexec/git-core}
node_bin=${SYMPHONY_PILOT_NODE_BIN:-/usr/bin/node}
npm_bin=${SYMPHONY_PILOT_NPM_BIN:-/usr/bin/npm}
bwrap_bin=${SYMPHONY_PILOT_BWRAP_BIN:-/opt/bubblewrap-0.11.2/bin/bwrap}
shell_bin=${SYMPHONY_PILOT_SHELL_BIN:-/bin/sh}
for trusted in "$git_bin" "$node_bin" "$npm_bin" "$bwrap_bin" "$shell_bin"; do
  [ -e "$trusted" ] || fail trusted-runtime-missing
done
[ -d "$git_exec_path" ] || fail trusted-runtime-missing

install_tmp=$(/usr/bin/mktemp -d /var/tmp/kaimono-baton-symphony-install.XXXXXX)
cleanup() {
  case "$install_tmp" in /var/tmp/kaimono-baton-symphony-install.*) /bin/rm -rf -- "$install_tmp" ;; esac
}
trap cleanup EXIT HUP INT TERM
/usr/bin/install -d -o root -g root -m 0700 "$install_tmp/home" "$install_tmp/xdg" "$install_tmp/hooks" "$install_tmp/state"

trusted_git() {
  git_cwd=$1
  shift
  /usr/bin/env -i PATH="${git_bin%/*}:$git_exec_path:/usr/bin:/bin" HOME="$install_tmp/home" XDG_CONFIG_HOME="$install_tmp/xdg" \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_EXEC_PATH="$git_exec_path" \
    GIT_CONFIG_COUNT=5 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$install_tmp/hooks" \
    GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1= \
    GIT_CONFIG_KEY_2=core.fsmonitor GIT_CONFIG_VALUE_2=false \
    GIT_CONFIG_KEY_3=protocol.file.allow GIT_CONFIG_VALUE_3=never \
    GIT_CONFIG_KEY_4=safe.directory GIT_CONFIG_VALUE_4="$git_cwd" \
    "$git_bin" -C "$git_cwd" "$@"
}

[ "$(trusted_git "$symphony_source_root" rev-parse --verify HEAD)" = "$symphony_sha" ] || fail symphony-source-base-invalid
[ -z "$(trusted_git "$symphony_source_root" status --porcelain=v1 --untracked-files=all --ignored=matching)" ] || fail symphony-source-not-clean

files='scripts/symphony-pilot-codex.sh
scripts/symphony-pilot-host.mjs
scripts/symphony-pilot-isolation-test.mjs
scripts/symphony-pilot-owner-identity.sh
scripts/symphony-pilot-trusted-launcher.sh
scripts/verify-symphony-pilot-upstream.mjs
symphony/WORKFLOW.md
symphony/codex/config.toml
symphony/patches/0001-disable-github-agent-tool.patch
symphony/runtime-identity.json'

/usr/bin/install -d -o root -g root -m 0755 "$destination/scripts" "$destination/symphony/codex" "$destination/symphony/patches"
printf '%s\n' "$files" | while IFS= read -r relative; do
  [ -f "$source_root/$relative" ] && [ ! -L "$source_root/$relative" ] || fail source-control-file-invalid
  mode=0644
  case "$relative" in scripts/*.sh|scripts/*.mjs) mode=0755 ;; esac
  /usr/bin/install -o root -g root -m "$mode" "$source_root/$relative" "$destination/$relative"
done

manifest="$destination/symphony/control-manifest.sha256"
(
  cd "$destination"
  printf '%s\n' "$files" | while IFS= read -r relative; do /usr/bin/sha256sum "$relative"; done
) >"$manifest"
/usr/bin/chown root:root "$manifest"
/usr/bin/chmod 0644 "$manifest"
/usr/bin/install -d -o root -g root -m 0755 "${launcher_path%/*}"
/usr/bin/install -o root -g root -m 0755 "$destination/scripts/symphony-pilot-trusted-launcher.sh" "$launcher_path"

/usr/bin/install -d -o root -g root -m 0755 "${symphony_destination%/*}" "$symphony_destination"
/bin/cp -a -- "$symphony_source_root/." "$symphony_destination/"
trusted_git "$symphony_destination" apply --check "$destination/symphony/patches/0001-disable-github-agent-tool.patch"
trusted_git "$symphony_destination" apply "$destination/symphony/patches/0001-disable-github-agent-tool.patch"
/usr/bin/chown -R root:root "$symphony_destination"
/usr/bin/chmod -R go-w "$symphony_destination"
/usr/bin/chmod 0755 "$symphony_destination"

/usr/bin/env -i \
  PATH="${node_bin%/*}:${git_bin%/*}:$git_exec_path:${npm_bin%/*}:${bwrap_bin%/*}:${shell_bin%/*}" \
  SYMPHONY_PILOT_CONTROL_ROOT="$destination" \
  SYMPHONY_PILOT_SYMPHONY_ROOT="$symphony_destination" \
  SYMPHONY_PILOT_STATE_DIR="$install_tmp/state" \
  SYMPHONY_PILOT_GIT_BIN="$git_bin" \
  SYMPHONY_PILOT_GIT_EXEC_PATH="$git_exec_path" \
  SYMPHONY_PILOT_NODE_BIN="$node_bin" \
  SYMPHONY_PILOT_NPM_BIN="$npm_bin" \
  SYMPHONY_PILOT_BWRAP_BIN="$bwrap_bin" \
  SYMPHONY_PILOT_SHELL_BIN="$shell_bin" \
  "$node_bin" "$destination/scripts/symphony-pilot-host.mjs" verify-symphony-runtime-only

printf '%s\n' "installed immutable pilot control root: $destination"
printf '%s\n' "installed trusted launcher: $launcher_path"
printf '%s\n' "installed immutable Symphony runtime source: $symphony_destination"
