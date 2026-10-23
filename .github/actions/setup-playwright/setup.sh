#!/usr/bin/env bash
# Playwright 설치를 단계별로 나누고, 단계마다 시간 상한을 둬서 멈추면 빠르게·분명하게 실패시킨다.
# 사용: setup.sh package | browsers | os-deps   (환경변수: PW_VERSION, PW_BROWSERS, PW_NPM_FLAGS)
set -uo pipefail

: "${PW_VERSION:?PW_VERSION is required}"
: "${PW_BROWSERS:=chromium}"
: "${PW_NPM_FLAGS:=--no-save}"

# 시간 상한 안에 끝나지 않으면 프로세스를 끊고 단계 이름이 보이는 오류를 남긴다.
# 사용: run_limited <단계 이름> <초> <명령...>
run_limited() {
  local label="$1" seconds="$2"
  shift 2
  timeout --kill-after=10 "$seconds" "$@"
  local rc=$?
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "::error title=Playwright 설치 멈춤::'${label}' 단계가 ${seconds}초 안에 끝나지 않아 중단했습니다. 네트워크(npm·Playwright CDN·apt 미러) 지연으로 보이며 코드 문제가 아닙니다. 이 job만 다시 실행하세요." >&2
  fi
  return "$rc"
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
  # shellcheck disable=SC2086
  local dry
  dry="$(run_limited "playwright install-deps --dry-run" 120 npx playwright install-deps --dry-run $PW_BROWSERS)" || exit 1
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
  # 느리거나 멈춘 미러에 매달리지 않도록 apt 자체 연결 시간 상한과 재시도를 둔다.
  printf '%s\n' \
    'Acquire::http::Timeout "20";' \
    'Acquire::https::Timeout "20";' \
    'Acquire::Retries "3";' \
    | sudo tee /etc/apt/apt.conf.d/99-ci-network-limits >/dev/null

  # 한 번 멈췄다면 같은 미러에 계속 매달리는 대신 끊고 한 번만 다시 시도한다(시험 재시도와 무관한 설치 단계 한정).
  local attempt
  for attempt in 1 2; do
    if run_limited "apt-get update (시도 ${attempt}/2)" 150 sudo apt-get update \
      && run_limited "apt-get install (시도 ${attempt}/2)" 240 \
        sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"; then
      return 0
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
