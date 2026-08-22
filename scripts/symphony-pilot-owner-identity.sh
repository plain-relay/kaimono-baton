#!/bin/sh
# Shared only by the immutable launcher and its Linux regression test.  The
# caller supplies its direct parent PID from the launcher shell; the identity
# itself is derived exclusively from trusted kernel state.

symphony_pilot_owner_process_identity() {
  instance_id=$1
  initial_parent=$2
  case "$instance_id" in ????????-????-[1-5]???-[89ab]???-????????????) ;; *) return 1 ;; esac
  case "$initial_parent" in ''|*[!0-9]*) return 1 ;; esac

  boot_id="$(/usr/bin/tr -d '\n' < /proc/sys/kernel/random/boot_id)" || return 1
  case "$boot_id" in ????????-????-????-????-????????????) ;; *) return 1 ;; esac

  pid=$initial_parent
  selected_pid=''
  selected_start=''
  depth=0
  while [ "$depth" -lt 32 ] && [ "$pid" -gt 1 ]; do
    [ -r "/proc/$pid/stat" ] && [ -r "/proc/$pid/comm" ] || return 1
    # Linux stat field 22 is the process start time. Kernel-generated comm is
    # not evaluated; shell wrappers are skipped so all launcher phases bind to
    # their common Symphony (or test worker) parent rather than a transient sh.
    stat_record="$(/usr/bin/cat "/proc/$pid/stat")" || return 1
    stat_tail=${stat_record##*) }
    set -- $stat_tail
    parent=$2
    start=$20
    comm="$(/usr/bin/tr -d '\n' < "/proc/$pid/comm")" || return 1
    case "$start:$parent" in *[!0-9:]*|:) return 1 ;; esac
    case "$comm" in
      sh|bash|dash|zsh|symphony-pilot-*) ;;
      *) selected_pid=$pid; selected_start=$start; break ;;
    esac
    pid=$parent
    depth=$((depth + 1))
  done
  [ -n "$selected_pid" ] && [ -n "$selected_start" ] || return 1
  /usr/bin/printf '%s\n%s\n%s\n%s\n' "$instance_id" "$boot_id" "$selected_pid" "$selected_start" | /usr/bin/sha256sum | /usr/bin/awk '{print $1}'
}
