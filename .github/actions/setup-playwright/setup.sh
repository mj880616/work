#!/usr/bin/env bash
# Playwright 설치를 단계별로 나누고, 단계마다 시간 상한을 둬서 멈추면 빠르게·분명하게 실패시킨다.
# 사용: setup.sh package | browsers | os-deps   (환경변수: PW_VERSION, PW_BROWSERS, PW_NPM_FLAGS)
set -uo pipefail

: "${PW_VERSION:?PW_VERSION is required}"
: "${PW_BROWSERS:=chromium}"
: "${PW_NPM_FLAGS:=--no-save}"

# 멈춘 단계의 apt·dpkg 프로세스와 마지막 apt 로그를 주석 한 줄로 남긴다.
diagnose() {
  case "$1" in apt-get*) ;; *) return 0 ;; esac
  local procs tail_log
  procs="$(ps -eo pid,etimes,stat,args 2>/dev/null | grep -E 'apt|dpkg|unattended|needrestart|fc-cache' | grep -v grep | cut -c1-110 | head -n 8 | tr '\n' ';')"
  tail_log="$(tail -n 6 /var/log/apt/term.log 2>/dev/null | cut -c1-110 | tr '\n' ';')"
  echo "::warning title=apt 멈춤 진단 (${1})::프로세스: ${procs:-없음} | apt term.log 끝: ${tail_log:-없음}"
}

# 시간 상한 안에 끝나지 않으면 프로세스를 끊고 단계 이름이 보이는 오류를 남긴다.
# 사용: run_limited <단계 이름> <초> <명령...>
run_limited() {
  local label="$1" seconds="$2"
  shift 2
  timeout --kill-after=10 "$seconds" "$@" &
  local tpid=$!
  # 끊기기 직전(상한 3초 전)에 아직 멈춰 있으면 원인 진단을 먼저 남긴다. 끊고 나면 프로세스가 사라져 볼 수 없다.
  (sleep $((seconds > 5 ? seconds - 3 : 1)); kill -0 "$tpid" 2>/dev/null && diagnose "$label") 2>/dev/null &
  local dpid=$!
  wait "$tpid"
  local rc=$?
  pkill -P "$dpid" 2>/dev/null
  kill "$dpid" 2>/dev/null
  { wait "$dpid"; } 2>/dev/null
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "::error title=Playwright 설치 멈춤::'${label}' 단계가 ${seconds}초 안에 끝나지 않아 중단했습니다. 네트워크(npm·Playwright CDN·apt 미러) 지연으로 보이며 코드 문제가 아닙니다. 이 job만 다시 실행하세요." >&2
  fi
  return "$rc"
}

# 러너 기본 apt 미러 선택(mirror+file)을 건너뛰고 Canonical 미러를 직접 쓴다.
use_direct_mirror() {
  local f
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
    [ -f "$f" ] && sudo sed -i -E 's#mirror\+file:/etc/apt/apt-mirrors\.txt#http://archive.ubuntu.com/ubuntu/#g' "$f"
  done
  return 0
}

# 주어진 패키지가 모두 설치되어 있으면 0.
all_installed() {
  local pkg
  for pkg in "$@"; do
    dpkg-query -W -f='${db:Status-Status}' "$pkg" 2>/dev/null | grep -qx installed || return 1
  done
  return 0
}

cmd_package() {
  # shellcheck disable=SC2086
  run_limited "npm install @playwright/test@${PW_VERSION}" 300 \
    npm install $PW_NPM_FLAGS "@playwright/test@${PW_VERSION}"
}

cmd_browsers() {
  # OS 패키지(apt)는 여기서 받지 않는다. 브라우저 파일만 받는다(--with-deps 쓰지 않음).
  # shellcheck disable=SC2086
  PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=30000 \
    run_limited "playwright install ${PW_BROWSERS}" 300 npx playwright install $PW_BROWSERS
}

cmd_os_deps() {
  local dry_file
  dry_file="$(mktemp)"
  # shellcheck disable=SC2086
  run_limited "playwright install-deps --dry-run" 120 bash -c 'npx playwright install-deps --dry-run $0 >"$1"' "$PW_BROWSERS" "$dry_file" || exit 1
  local dry
  dry="$(cat "$dry_file")"
  local packages
  packages="$(printf '%s\n' "$dry" | sed -n 's/.*--no-install-recommends \([^"]*\)".*/\1/p' | head -n 1)"
  if [ -z "$packages" ]; then
    echo "::error title=Playwright OS 의존 패키지 목록을 읽지 못함::install-deps --dry-run 출력 형식이 달라졌습니다. 출력:"
    printf '%s\n' "$dry"
    exit 1
  fi

  local missing=() pkg
  for pkg in $packages; do
    if ! dpkg-query -W -f='${db:Status-Status}' "$pkg" 2>/dev/null | grep -qx installed; then
      missing+=("$pkg")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    echo "OS 의존 패키지 $(printf '%s\n' $packages | wc -l)개가 모두 설치되어 있어 apt를 건너뜁니다."
    return 0
  fi

  echo "설치가 필요한 OS 패키지 ${#missing[@]}개: ${missing[*]}"
  echo "::notice title=Playwright 필요한 OS 패키지 ${#missing[@]}개::${missing[*]}"
  # 이전 실행이 받아 둔 deb 캐시가 있으면 네트워크 없이 설치한다(미러에 닿지 않으므로 멈출 일이 없다).
  local deb_dir="${PW_DEB_DIR:-$HOME/.cache/playwright-os-debs}"
  if compgen -G "$deb_dir/*.deb" >/dev/null; then
    echo "캐시된 deb $(ls "$deb_dir"/*.deb | wc -l)개로 설치를 시도합니다."
    if run_limited "dpkg -i (캐시된 deb)" 90 sudo env DEBIAN_FRONTEND=noninteractive dpkg -i "$deb_dir"/*.deb && all_installed "${missing[@]}"; then
      echo "캐시된 deb 설치 완료(apt 사용 안 함)."
      return 0
    fi
    echo "::warning title=캐시된 deb 설치 실패::apt로 새로 받습니다."
    sudo dpkg --configure -a >/dev/null 2>&1 || true
  fi

  # 느리거나 멈춘 미러에 매달리지 않도록 apt 자체 연결 시간 상한과 재시도를 둔다.
  printf '%s\n' \
    'Acquire::http::Timeout "20";' \
    'Acquire::https::Timeout "20";' \
    'Acquire::Retries "3";' \
    | sudo tee /etc/apt/apt.conf.d/99-ci-network-limits >/dev/null

  # 한 번 멈췄다면 같은 미러·같은 잠금에 계속 매달리는 대신 끊고 한 번만 다시 시도한다(시험 재시도와 무관한 설치 단계 한정).
  # 관측: 멈춤은 러너 기본 미러 선택(mirror+file) 경유 '패키지 받기'에서 났다. 두 번째 시도는 archive.ubuntu.com을 직접 쓴다.
  # 받기(download-only)와 설치(dpkg)를 나눠, 멈춘 곳이 미러인지 설치인지 단계 이름으로 드러나게 한다.
  local attempt apt_opts=(-o DPkg::Lock::Timeout=30)
  for attempt in 1 2; do
    if [ "$attempt" -gt 1 ]; then
      # 앞 시도가 설치 도중 끊겼다면 dpkg 상태를 먼저 정리하고, 미러를 직접 주소로 바꾼다.
      run_limited "dpkg --configure -a" 60 sudo dpkg --configure -a
      use_direct_mirror
    fi
    sudo apt-get clean
    if run_limited "apt-get update (시도 ${attempt}/2)" 90 sudo apt-get "${apt_opts[@]}" update \
      && run_limited "apt-get 패키지 받기 (시도 ${attempt}/2)" 75 \
        sudo env DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" install -y --no-install-recommends --download-only "${missing[@]}"; then
      # 받은 deb를 캐시 폴더에 보관한다(다음 실행은 apt 없이 설치). 저장 여부는 workflow 단계가 정한다.
      mkdir -p "$deb_dir" && sudo cp /var/cache/apt/archives/*.deb "$deb_dir"/ 2>/dev/null && sudo chown -R "$(id -u):$(id -g)" "$deb_dir"
      if [ -n "${GITHUB_OUTPUT:-}" ] && compgen -G "$deb_dir/*.deb" >/dev/null; then echo "debs_ready=true" >> "$GITHUB_OUTPUT"; fi
      if run_limited "apt-get 설치 (시도 ${attempt}/2)" 120 \
        sudo env DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" install -y --no-install-recommends "${missing[@]}"; then
        return 0
      fi
    fi
    echo "apt 단계가 실패했습니다(시도 ${attempt}/2)."
  done
  echo "::error title=Playwright OS 패키지 설치 실패::apt 두 번 시도가 모두 실패했습니다."
  return 1
}

case "${1:-}" in
  package) cmd_package ;;
  browsers) cmd_browsers ;;
  os-deps) cmd_os_deps ;;
  *) echo "usage: $0 package|browsers|os-deps" >&2; exit 2 ;;
esac
