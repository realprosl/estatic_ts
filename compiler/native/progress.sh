#!/usr/bin/env bash
# Terminal presentation only; commands retain stdout, stderr and exit status.
# Sourced by the installer, the seed builder and the self-hosting build.
etsc_color() {
  [[ -t 2 && ! ${NO_COLOR+x} && ${TERM:-} != dumb && -z ${CI:-} ]]
}
etsc_duration() {
  local seconds=$1
  if (( seconds < 60 )); then printf '%s s' "$seconds"; else printf '%s min %s s' "$((seconds / 60))" "$((seconds % 60))"; fi
}
etsc_info() {
  if etsc_color; then printf '\033[35m[%s]\033[0m %s\n' "${ETSC_CLI_SCOPE:-compiler}" "$*" >&2;
  else printf '[%s] %s\n' "${ETSC_CLI_SCOPE:-compiler}" "$*" >&2; fi
}
_etsc_command() {
  local spin=$1 label=$2
  shift 2
  local started=$SECONDS status=0 scope=${ETSC_CLI_SCOPE:-compiler}
  if [[ -n ${ETSC_LOG_FILE:-} ]]; then : > "$ETSC_LOG_FILE"; fi
  if [[ $spin == 1 ]] && etsc_color; then
    local etsc_pid reader fifo_dir frame=0 monitor=0 columns=80
    if [[ ${COLUMNS:-80} =~ ^[0-9]{1,4}$ ]]; then columns=${COLUMNS:-80}; fi
    local old_int old_term
    old_int=$(trap -p INT); old_term=$(trap -p TERM)
    # Forward complete diagnostic lines while the active row is redrawn.
    fifo_dir=$(mktemp -d "${TMPDIR:-/tmp}/etsc-cli.XXXXXX") || return 1
    mkfifo "$fifo_dir/errors" || { rmdir "$fifo_dir"; return 1; }
    while IFS= read -r line || [[ -n $line ]]; do
      if [[ -n ${ETSC_LOG_FILE:-} ]]; then printf '%s\n' "$line" >> "$ETSC_LOG_FILE"; fi
      printf '\r\033[2K%s\n' "$line" >&2
    done < "$fifo_dir/errors" &
    reader=$!
    # Give the command its own process group so cancelling a long bootstrap
    # also terminates compiler children and parallel analysis workers.
    [[ $- != *m* ]] || monitor=1
    set -m
    "$@" 2> "$fifo_dir/errors" &
    etsc_pid=$!
    (( monitor != 0 )) || set +m
    trap 'kill -TERM -- "-$etsc_pid" 2>/dev/null || true; wait "$etsc_pid" 2>/dev/null || true; wait "$reader" 2>/dev/null || true; rm -f "$fifo_dir/errors"; rmdir "$fifo_dir"; printf "\r\033[2K\033[0m" >&2; exit 130' INT
    trap 'kill -TERM -- "-$etsc_pid" 2>/dev/null || true; wait "$etsc_pid" 2>/dev/null || true; wait "$reader" 2>/dev/null || true; rm -f "$fifo_dir/errors"; rmdir "$fifo_dir"; printf "\r\033[2K\033[0m" >&2; exit 143' TERM
    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    while kill -0 "$etsc_pid" 2>/dev/null; do
      local elapsed text="$label" available left right
      elapsed=$(etsc_duration "$((SECONDS-started))")
      available=$((columns-${#scope}-${#elapsed}-9))
      if (( available < 1 )); then available=1; fi
      if (( ${#text} > available )); then left=$(((available-1)/2)); right=$((available-1-left)); text="${text:0:left}…${text:${#text}-right:right}"; fi
      printf '\r\033[2K\033[35m[%s]\033[0m \033[36m%s\033[0m %s\033[2m · %s\033[0m' "${ETSC_CLI_SCOPE:-compiler}" "${frames[frame % 10]}" "$text" "$elapsed" >&2
      frame=$((frame+1)); sleep 0.1
    done
    wait "$etsc_pid" || status=$?
    wait "$reader" || true
    rm -f "$fifo_dir/errors"; rmdir "$fifo_dir"
    printf '\r\033[2K' >&2
    trap - INT TERM
    [[ -z $old_int ]] || eval "$old_int"
    [[ -z $old_term ]] || eval "$old_term"
  else
    etsc_info "> $label"
    if [[ -n ${ETSC_LOG_FILE:-} ]]; then
      local log_dir log_reader
      log_dir=$(mktemp -d "${TMPDIR:-/tmp}/etsc-cli.XXXXXX") || return 1
      mkfifo "$log_dir/errors" || { rmdir "$log_dir"; return 1; }
      tee "$ETSC_LOG_FILE" < "$log_dir/errors" >&2 &
      log_reader=$!
      "$@" 2> "$log_dir/errors" || status=$?
      wait "$log_reader" || true
      rm -f "$log_dir/errors"; rmdir "$log_dir"
    else "$@" || status=$?; fi
  fi
  local marker='✓' color=32
  if (( status != 0 )); then marker='✗'; color=31; fi
  if etsc_color; then printf '\033[35m[%s]\033[0m \033[%sm%s\033[0m %s (%s)\n' "${ETSC_CLI_SCOPE:-compiler}" "$color" "$marker" "$label" "$(etsc_duration "$((SECONDS-started))")" >&2
  else printf '[%s] %s %s (%s)\n' "${ETSC_CLI_SCOPE:-compiler}" "$marker" "$label" "$(etsc_duration "$((SECONDS-started))")" >&2; fi
  return "$status"
}
etsc_spin() { _etsc_command 1 "$@"; }
etsc_step() { _etsc_command 0 "$@"; }
