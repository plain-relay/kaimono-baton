#!/bin/sh
set -eu

fail() {
  printf '%s\n' "[symphony-pilot-install] $1" >&2
  exit 1
}

assert_root_immutable_ancestors() {
  current=$1
  while :; do
    [ -d "$current" ] && [ ! -L "$current" ] || fail installer-source-ancestor-invalid
    [ "$(/usr/bin/readlink -f -- "$current")" = "$current" ] || fail installer-source-ancestor-invalid
    [ "$(/usr/bin/stat -c %u -- "$current")" = 0 ] || fail installer-source-owner-invalid
    mode=$(/usr/bin/stat -c %a -- "$current")
    [ "$((0$mode & 022))" -eq 0 ] || fail installer-source-writable
    [ "$current" = / ] && return
    current=$(/usr/bin/dirname -- "$current")
  done
}

assert_root_immutable_tree() {
  target=$1
  assert_root_immutable_ancestors "$target"
  if /usr/bin/find -P "$target" -xdev -type l -print -quit | /usr/bin/grep -q .; then fail installer-source-symlink; fi
  if /usr/bin/find -P "$target" -xdev ! -type d ! -type f -print -quit | /usr/bin/grep -q .; then fail installer-source-file-type-invalid; fi
  if /usr/bin/find -P "$target" -xdev ! -uid 0 -print -quit | /usr/bin/grep -q .; then fail installer-source-owner-invalid; fi
  if /usr/bin/find -P "$target" -xdev -perm /022 -print -quit | /usr/bin/grep -q .; then fail installer-source-writable; fi
}

assert_trusted_runtime_file() {
  target=$1
  [ -f "$target" ] && [ ! -L "$target" ] || fail trusted-runtime-invalid
  parent=$(/usr/bin/dirname -- "$target")
  assert_root_immutable_ancestors "$parent"
  [ "$(/usr/bin/stat -c %u -- "$target")" = 0 ] || fail trusted-runtime-invalid
  mode=$(/usr/bin/stat -c %a -- "$target")
  [ "$((0$mode & 022))" -eq 0 ] || fail trusted-runtime-invalid
}

paths_overlap() {
  case "$1/" in "$2/"*) return 0 ;; esac
  case "$2/" in "$1/"*) return 0 ;; esac
  return 1
}

assert_trusted_node_root() {
  candidate=$1
  case "$candidate" in /*) ;; *) fail trusted-node-root-not-absolute ;; esac
  trusted_node_root=$(/usr/bin/readlink -f -- "$candidate") || fail trusted-node-root-invalid
  [ "$trusted_node_root" = "$candidate" ] || fail trusted-node-root-not-canonical
  [ -d "$trusted_node_root" ] && [ ! -L "$trusted_node_root" ] || fail trusted-node-root-invalid
  for protected in "$source_root" "$destination" "$symphony_destination" "$launcher_path"; do
    paths_overlap "$trusted_node_root" "$protected" && fail trusted-node-root-overlap
  done
  assert_root_immutable_ancestors "$trusted_node_root"
  if /usr/bin/find -P "$trusted_node_root" -xdev ! -type d ! -type f ! -type l -print -quit | /usr/bin/grep -q .; then fail trusted-node-root-file-type-invalid; fi
  if /usr/bin/find -P "$trusted_node_root" -xdev ! -uid 0 -print -quit | /usr/bin/grep -q .; then fail trusted-node-root-owner-invalid; fi
  if /usr/bin/find -P "$trusted_node_root" -xdev \( -type d -o -type f \) -perm /022 -print -quit | /usr/bin/grep -q .; then fail trusted-node-root-writable; fi
  /usr/bin/find -P "$trusted_node_root" -xdev -type l -exec /bin/sh -c '
    root=$1
    shift
    for link do
      target=$(/usr/bin/readlink -f -- "$link") || exit 1
      case "$target" in "$root"/*) ;; *) exit 1 ;; esac
    done
  ' /bin/sh "$trusted_node_root" {} + || fail trusted-node-root-symlink-escape

  node_entry="$trusted_node_root/bin/node"
  npm_entry="$trusted_node_root/bin/npm"
  [ -f "$node_entry" ] || fail trusted-node-root-invalid
  [ -f "$npm_entry" ] || fail trusted-node-root-invalid
  node_bin=$(/usr/bin/readlink -f -- "$node_entry") || fail trusted-node-root-invalid
  npm_bin=$(/usr/bin/readlink -f -- "$npm_entry") || fail trusted-node-root-invalid
  case "$node_bin" in "$trusted_node_root"/*) ;; *) fail trusted-node-root-symlink-escape ;; esac
  case "$npm_bin" in "$trusted_node_root"/*) ;; *) fail trusted-node-root-symlink-escape ;; esac
  assert_trusted_runtime_file "$node_bin"
  assert_trusted_runtime_file "$npm_bin"
  [ -x "$node_bin" ] && [ -x "$npm_bin" ] || fail trusted-node-root-invalid
  node_version=$(/usr/bin/env -i PATH="$trusted_node_root/bin:/usr/bin:/bin" HOME=/var/empty NPM_CONFIG_USERCONFIG=/dev/null "$node_bin" --version) || fail trusted-node-version-invalid
  node_major=${node_version#v}
  node_major=${node_major%%.*}
  [ "$node_major" = 22 ] || fail trusted-node-version-invalid
  npm_version=$(/usr/bin/env -i PATH="$trusted_node_root/bin:/usr/bin:/bin" HOME=/var/empty NPM_CONFIG_USERCONFIG=/dev/null "$npm_bin" --version) || fail trusted-node-runtime-invalid
}

[ "$(/usr/bin/id -u)" = 0 ] || fail root-required-run-explicitly
[ "$#" -ge 5 ] && [ "$#" -le 6 ] || fail 'usage: install-symphony-pilot-control.sh ROOT_OWNED_SOURCE_ROOT SOURCE_COMMIT VERSION_OR_SHA CLEAN_SYMPHONY_SOURCE_ROOT TRUSTED_NODE_ROOT [LAUNCHER_PATH]'

case "$1" in /*) ;; *) fail installer-source-root-not-absolute ;; esac
source_root=$(/usr/bin/readlink -f -- "$1")
[ "$source_root" = "$1" ] || fail installer-source-root-not-canonical
case "$0" in /*) ;; *) fail installer-self-path-mismatch ;; esac
installer_path=$(/usr/bin/readlink -f -- "$0")
[ "$installer_path" = "$0" ] || fail installer-self-path-mismatch
[ "$installer_path" = "$source_root/scripts/install-symphony-pilot-control.sh" ] || fail installer-self-path-mismatch

source_commit=$2
version=$3
symphony_source_root=$(/usr/bin/readlink -f -- "$4")
trusted_node_root=$5
launcher_path=${6:-/opt/plain-relay/kaimono-baton-symphony-launcher}
case "$source_commit" in *[!0123456789abcdef]*|'') fail installer-source-commit-invalid ;; esac
[ "${#source_commit}" -eq 40 ] || fail installer-source-commit-invalid
case "$version" in *[!A-Za-z0-9._-]*|'') fail invalid-version ;; esac
case "$version" in .|..) fail invalid-version ;; esac
destination="/opt/plain-relay/kaimono-baton-symphony-control/$version"
symphony_sha=8001b52e3062495a16e520e4ceaf8f9de868c4d0
symphony_destination=/opt/plain-relay/openai-symphony-8001b52e
[ ! -e "$destination" ] || fail destination-already-exists
[ ! -e "$symphony_destination" ] || fail symphony-destination-already-exists
case "$launcher_path" in /*) ;; *) fail launcher-path-not-absolute ;; esac
case "$launcher_path/" in "$destination/"*) fail launcher-inside-control-root ;; esac

# This check runs before any project JavaScript is executed. The source checkout
# and every member (including .git) must already be the root-owned staging tree.
assert_root_immutable_tree "$source_root"

git_bin=/opt/git-2.50.1/bin/git
git_exec_path=/opt/git-2.50.1/libexec/git-core
bwrap_bin=/opt/bubblewrap-0.11.2/bin/bwrap
shell_bin=$(/usr/bin/readlink -f -- /bin/sh)
[ -d "$git_exec_path" ] && [ ! -L "$git_exec_path" ] || fail trusted-git-runtime-invalid
git_root=$(/usr/bin/dirname -- "$(/usr/bin/dirname -- "$git_bin")")
[ "$git_bin" = "$git_root/bin/git" ] && [ "$git_exec_path" = "$git_root/libexec/git-core" ] || fail trusted-git-runtime-invalid
assert_trusted_runtime_file "$git_bin"
assert_root_immutable_ancestors "$git_exec_path"
[ "$("$git_bin" --version)" = 'git version 2.50.1' ] || fail trusted-git-runtime-invalid
[ "$("$git_bin" --exec-path)" = "$git_exec_path" ] || fail trusted-git-runtime-invalid
for helper_name in git-remote-http git-remote-https; do
  helper_path=$(/usr/bin/readlink -f -- "$git_exec_path/$helper_name")
  case "$helper_path" in "$git_root"/*) ;; *) fail trusted-git-runtime-invalid ;; esac
  assert_trusted_runtime_file "$helper_path"
done
for trusted in "$bwrap_bin" "$shell_bin"; do assert_trusted_runtime_file "$trusted"; done
assert_trusted_node_root "$trusted_node_root"

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
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_EXEC_PATH="$git_exec_path" GIT_NO_REPLACE_OBJECTS=1 \
    GIT_CONFIG_COUNT=5 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$install_tmp/hooks" \
    GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1= \
    GIT_CONFIG_KEY_2=core.fsmonitor GIT_CONFIG_VALUE_2=false \
    GIT_CONFIG_KEY_3=protocol.file.allow GIT_CONFIG_VALUE_3=never \
    GIT_CONFIG_KEY_4=safe.directory GIT_CONFIG_VALUE_4="$git_cwd" \
    "$git_bin" -C "$git_cwd" "$@"
}

# The testable verifier repeats the path/ownership checks and proves HEAD, tree,
# repository URL, source cleanliness, config, object-store, replacement refs, and
# every copied control blob against SOURCE_COMMIT before any control file is copied.
/usr/bin/env -i PATH="${node_bin%/*}:${git_bin%/*}:$git_exec_path:/usr/bin:/bin" \
  "$node_bin" "$source_root/scripts/symphony-pilot-install-source.mjs" \
  "$source_root" "$source_commit" "$installer_path" "$git_bin" "$git_exec_path" \
  "$install_tmp/home" "$install_tmp/xdg" "$install_tmp/hooks" "$trusted_node_root" \
  "$destination" "$symphony_destination" "$launcher_path"

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
  GIT_NO_REPLACE_OBJECTS=1 \
  "$node_bin" "$destination/scripts/symphony-pilot-host.mjs" verify-symphony-runtime-only

printf '%s\n' "installed immutable pilot control root: $destination"
printf '%s\n' "installed trusted launcher: $launcher_path"
printf '%s\n' "installed immutable Symphony runtime source: $symphony_destination"
