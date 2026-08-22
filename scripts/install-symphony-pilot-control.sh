#!/bin/sh
set -eu

fail() {
  printf '%s\n' "[symphony-pilot-install] $1" >&2
  exit 1
}

[ "$(/usr/bin/id -u)" = 0 ] || fail root-required-run-explicitly
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || fail 'usage: install-symphony-pilot-control.sh SOURCE_ROOT VERSION_OR_SHA [LAUNCHER_PATH]'

source_root="$(/usr/bin/readlink -f -- "$1")"
version=$2
launcher_path=${3:-/usr/local/libexec/kaimono-baton-symphony-launcher}
case "$version" in *[!A-Za-z0-9._-]*|'') fail invalid-version ;; esac
case "$version" in .|..) fail invalid-version ;; esac
destination="/opt/plain-relay/kaimono-baton-symphony-control/$version"
[ ! -e "$destination" ] || fail destination-already-exists
case "$launcher_path" in /*) ;; *) fail launcher-path-not-absolute ;; esac
case "$launcher_path/" in "$destination/"*) fail launcher-inside-control-root ;; esac

files='scripts/symphony-pilot-codex.sh
scripts/symphony-pilot-host.mjs
scripts/symphony-pilot-isolation-test.mjs
scripts/symphony-pilot-trusted-launcher.sh
scripts/verify-symphony-pilot-upstream.mjs
symphony/WORKFLOW.md
symphony/codex/config.toml
symphony/patches/0001-disable-github-agent-tool.patch'

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

printf '%s\n' "installed immutable pilot control root: $destination"
printf '%s\n' "installed trusted launcher: $launcher_path"
