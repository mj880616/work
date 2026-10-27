#!/usr/bin/env bash
# Web session (cloud container, runs as root) helper for the repo's DB tests.
# Reuses tests/auth-handoff (embedded-postgres 17.6 + pg, locked by its package-lock.json).
# The tests start their own throw-away clusters; initdb refuses root, so they must
# run as a non-root user. No secrets are created, printed or committed.
#
#   scripts/web-session-db-test.sh setup            user + locale + npm ci (idempotent)
#   scripts/web-session-db-test.sh test [files...]  run tests/auth-handoff tests as the non-root user
#   scripts/web-session-db-test.sh start            standalone PostgreSQL (reuses a running one)
#   scripts/web-session-db-test.sh status|stop|clean
#
# Env: WEB_TEST_USER (pgtest) WEB_TEST_PORT (54329) WEB_TEST_DIR (/tmp/web-session-pg)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUITE="$REPO/tests/auth-handoff"
WEB_TEST_USER="${WEB_TEST_USER:-pgtest}"
WEB_TEST_PORT="${WEB_TEST_PORT:-54329}"
WEB_TEST_DIR="${WEB_TEST_DIR:-/tmp/web-session-pg}"
BIN="$SUITE/node_modules/@embedded-postgres/linux-x64/native/bin"
LOCALE="en_US.UTF-8"

die() { echo "web-session-db-test: $*" >&2; exit 1; }

as_user() {  # run a command as the non-root test user (or directly if already non-root)
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$WEB_TEST_USER" -- env HOME="$WEB_TEST_DIR/home" PATH="$PATH" "$@"
  else
    env "$@"
  fi
}

ensure_user() {
  [ "$(id -u)" -eq 0 ] || return 0
  mkdir -p "$WEB_TEST_DIR/home"
  id "$WEB_TEST_USER" >/dev/null 2>&1 || useradd --system --home-dir "$WEB_TEST_DIR/home" --shell /usr/sbin/nologin "$WEB_TEST_USER"
  chown "$WEB_TEST_USER" "$WEB_TEST_DIR" "$WEB_TEST_DIR/home"
  # The user must be able to read the repo (a home directory with mode 700 blocks it).
  as_user test -r "$SUITE/package.json" || die "$WEB_TEST_USER cannot read $SUITE (check directory permissions)"
}

ensure_locale() {
  if locale -a 2>/dev/null | grep -qix 'en_US.utf-\?8'; then return 0; fi
  [ "$(id -u)" -eq 0 ] || die "locale $LOCALE missing and not root to generate it"
  localedef -i en_US -f UTF-8 en_US.UTF-8 || die "localedef failed (is /usr/share/i18n/locales/en_US present?)"
}

ensure_deps() {
  if ! { [ -x "$BIN/initdb" ] && [ -d "$SUITE/node_modules/pg" ]; }; then
    (cd "$SUITE" && npm ci --no-audit --no-fund)
    [ -x "$BIN/initdb" ] || die "embedded-postgres binaries missing after npm ci (platform must be linux-x64)"
  fi
  # embedded-postgres chmods its own binaries, so the test user must own node_modules (gitignored).
  if [ "$(id -u)" -eq 0 ]; then chown -R "$WEB_TEST_USER" "$SUITE/node_modules"; fi
}

setup() { mkdir -p "$WEB_TEST_DIR"; ensure_user; ensure_locale; ensure_deps; echo "setup ok (user=$WEB_TEST_USER)"; }

pg_running() { as_user "$BIN/pg_ctl" status -D "$WEB_TEST_DIR/data" >/dev/null 2>&1; }

cmd="${1:-}"
case "$cmd" in
  setup) setup ;;
  test)
    shift; setup
    cd "$SUITE"
    if [ "$#" -eq 0 ]; then as_user npm test; else as_user node --test "$@"; fi ;;
  start)
    setup
    if pg_running; then echo "already running on port $WEB_TEST_PORT"; exit 0; fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$WEB_TEST_PORT") 2>/dev/null; then die "port $WEB_TEST_PORT is in use; set WEB_TEST_PORT"; fi
    rm -rf "$WEB_TEST_DIR/data"
    as_user "$BIN/initdb" -D "$WEB_TEST_DIR/data" -U postgres -A trust --encoding=UTF8 --locale="$LOCALE" >/dev/null
    as_user "$BIN/pg_ctl" start -w -D "$WEB_TEST_DIR/data" -l "$WEB_TEST_DIR/pg.log" \
      -o "-h 127.0.0.1 -p $WEB_TEST_PORT -k $WEB_TEST_DIR" >/dev/null
    echo "started: host=127.0.0.1 port=$WEB_TEST_PORT user=postgres (trust auth, localhost only, locale $LOCALE)" ;;
  status) if pg_running; then echo "running (port $WEB_TEST_PORT)"; else echo "not running"; fi ;;
  stop) if pg_running; then as_user "$BIN/pg_ctl" stop -m fast -D "$WEB_TEST_DIR/data" >/dev/null; fi; echo "stopped" ;;
  clean)
    "$0" stop >/dev/null || true
    # Leftover test clusters (killed test runs) and their temp dirs, owned by the test user only.
    pkill -u "$WEB_TEST_USER" -x postgres 2>/dev/null || true
    find /tmp -maxdepth 1 -user "$WEB_TEST_USER" -name '*-pg-*' -exec rm -rf {} + 2>/dev/null || true
    case "$WEB_TEST_DIR" in /tmp/*) rm -rf "$WEB_TEST_DIR/data" "$WEB_TEST_DIR/pg.log" ;; esac
    echo "cleaned" ;;
  *) sed -n 2,13p "$0" | sed 's/^# \?//'; exit 2 ;;
esac
