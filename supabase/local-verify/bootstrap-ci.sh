#!/usr/bin/env bash
set -euo pipefail
umask 077

script_dir="${BASH_SOURCE[0]%/*}"
repo_root="$(cd "$script_dir/../.." && pwd)"
baseline="${WEB2_BASELINE_FILE:-$repo_root/supabase/local-verify/baseline.sql}"
expected_hash="${WEB2_BASELINE_SHA256:-}"
if [[ ! -s "$baseline" ]]; then
  echo 'A reviewed schema-only baseline.sql is required; no production connection is attempted.' >&2
  exit 1
fi
node "$repo_root/supabase/local-verify/check-baseline.mjs" "$baseline" "$expected_hash"
node "$repo_root/supabase/local-verify/scan-schema.mjs" "$baseline"
# The extraction step sets read-only/TLS settings for the production connection.
# The disposable local stack must never inherit a production endpoint or those settings.
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGOPTIONS PGSSLMODE PGSSLROOTCERT
command -v docker >/dev/null || { echo 'Docker is unavailable on this runner' >&2; exit 1; }
command -v supabase >/dev/null || { echo 'Supabase CLI is unavailable on this runner' >&2; exit 1; }
command -v psql >/dev/null || { echo 'Postgres client is unavailable on this runner' >&2; exit 1; }

ci_root="$(mktemp -d)"
network_name="web2-local-authz-${GITHUB_RUN_ID:-$$}"
cleanup() {
  if [[ -f "$ci_root/supabase/config.toml" ]]; then
    (cd "$ci_root" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  docker network rm "$network_name" >/dev/null 2>&1 || true
  if [[ -n "$ci_root" && "$ci_root" == /tmp/* ]]; then rm -rf -- "$ci_root"; fi
}
trap cleanup EXIT

# Supabase recommends a loopback-bound network for local development stacks.
docker network create --driver bridge \
  -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
  "$network_name" >/dev/null

cd "$ci_root"
supabase init > "$ci_root/init.log" 2>&1 || { echo 'Local Supabase init failed' >&2; exit 1; }
mkdir -p supabase/migrations supabase/functions
# Print resource sizes and availability only; never print Docker or CLI output.
node "$repo_root/supabase/local-verify/diagnose-start.mjs" preflight || {
  echo 'LOCAL_PREFLIGHT_FAILED: Docker daemon, Supabase CLI or local config unavailable' >&2
  exit 1
}
# A fresh Supabase instance already has PostgreSQL's public schema. Keep the
# reviewed dump untouched and make only these two schema declarations idempotent
# in the disposable copy; all object definitions, grants, and policies remain.
sed -E 's/^CREATE SCHEMA (public|private);$/CREATE SCHEMA IF NOT EXISTS \1;/' \
  "$baseline" > "$ci_root/baseline-local.sql"
node "$repo_root/supabase/local-verify/compat-default-acl.mjs" split \
  "$ci_root/baseline-local.sql" "$ci_root/baseline-apply.sql" "$ci_root/admin-default-acl.sql"
for name in meeting-ai-draft meeting-ai-ingest meeting-files; do
  cp -R "$repo_root/supabase/functions/$name" "supabase/functions/$name"
done
# This is a synthetic, unusable key. Authorized draft tests stop before an AI call.
printf 'OPENAI_API_KEY=local-ci-placeholder\n' > supabase/functions/.env

if ! supabase start --network-id "$network_name" > "$ci_root/start.log" 2>&1; then
  node "$repo_root/supabase/local-verify/diagnose-start.mjs" failure "$ci_root/start.log"
  echo 'LOCAL_STACK_START_FAILED: startup output was classified without printing raw output' >&2
  exit 1
fi
echo 'LOCAL_STACK_START_PASSED'
supabase status -o env > "$ci_root/status.env" 2> "$ci_root/status-error.log" || {
  echo 'Could not read local Supabase status' >&2; exit 1;
}
# Supabase CLI generated this file locally; it contains local-only keys.
set -a
source "$ci_root/status.env"
set +a
export API_URL DB_URL ANON_KEY SERVICE_ROLE_KEY
case "${API_URL:-}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo 'Supabase API URL is not loopback; refusing to continue' >&2; exit 1 ;;
esac
case "${DB_URL:-}" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Supabase DB URL is not loopback; refusing to continue' >&2; exit 1 ;;
esac
[[ -n "${ANON_KEY:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] || {
  echo 'Local API keys are missing' >&2; exit 1;
}
admin_db_url="$(node -e 'const u=new URL(process.env.DB_URL);if(!["127.0.0.1","localhost"].includes(u.hostname))process.exit(1);u.username="supabase_admin";process.stdout.write(u.toString())')"
if ! psql "$admin_db_url" -X -qAt -v ON_ERROR_STOP=1 -c 'select current_user' \
  > "$ci_root/admin-login.log" 2> "$ci_root/admin-login.err" || \
  ! grep -qx 'supabase_admin' "$ci_root/admin-login.log"; then
  echo 'LOCAL_ADMIN_LOGIN_FAILED: cannot apply original default ACL as its owner' >&2
  exit 1
fi

# Diagnostic mode compares catalog metadata only. It never applies the hosted
# baseline, seed, migration, or production credentials to the local stack.
if [[ "${WEB2_ROLE_DIAGNOSTIC:-0}" == 1 ]]; then
  [[ -s "${WEB2_HOSTED_ROLES_FILE:-}" ]] || {
    echo 'Read-only hosted role catalog was not captured' >&2; exit 1;
  }
  if ! psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -f "$repo_root/supabase/local-verify/role-catalog.sql" \
    > "$ci_root/local-roles.json" 2> "$ci_root/local-roles.err"; then
    echo 'LOCAL_ROLE_CATALOG_FAILED: SQL error withheld' >&2; exit 1;
  fi
  node "$repo_root/supabase/local-verify/role-diagnostics.mjs" compare \
    "$baseline" 10343 "$WEB2_HOSTED_ROLES_FILE" "$ci_root/local-roles.json"
  echo 'LOCAL_ADMIN_SAME_PASSWORD_LOGIN=true'
  echo 'LOCAL_ROLE_DIAGNOSTIC_PASSED'
  exit 0
fi

# The reviewed dump uses PostgreSQL 17's \restrict directive. Use the same
# major client as extraction; the runner's distro psql may be older.
if ! PGOPTIONS='-c app.local_verification=on' docker run --rm --network host --read-only \
  --tmpfs /tmp:rw,noexec,nosuid -e DB_URL -e PGOPTIONS \
  -v "$ci_root/baseline-apply.sql:/verify/baseline.sql:ro" postgres:17 \
  sh -c 'psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never -f /verify/baseline.sql' \
  > "$ci_root/baseline-apply.log" 2>&1; then
  node "$repo_root/supabase/local-verify/analyze-baseline.mjs" failure \
    "$baseline" "$ci_root/baseline-apply.log"
  echo 'BASELINE_APPLY_FAILED: first SQLSTATE and dump object reported; raw SQL withheld' >&2
  exit 1
fi
if ! PGOPTIONS='-c app.local_verification=on' psql "$admin_db_url" -X -q \
  -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
  -f "$ci_root/admin-default-acl.sql" > "$ci_root/admin-default-acl.log" 2>&1; then
  node "$repo_root/supabase/local-verify/compat-default-acl.mjs" failure \
    "$ci_root/admin-default-acl.sql" "$ci_root/admin-default-acl.log"
  echo 'ADMIN_DEFAULT_ACL_APPLY_FAILED: original SQL withheld' >&2
  exit 1
fi
echo 'ADMIN_DEFAULT_ACL_APPLY_PASSED'
echo 'BASELINE_APPLY_PASSED'

if ! PGOPTIONS='-c app.local_verification=on' psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/local-verify/custom-auth-trigger.sql" > "$ci_root/auth-trigger.log" 2>&1; then
  echo 'Local custom Auth trigger setup failed; SQL output is withheld' >&2
  exit 1
fi
node "$repo_root/supabase/local-verify/create-local-auth.mjs" "$ci_root/users.json"
if ! PGOPTIONS='-c app.local_verification=on' psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/local-verify/seed-before-cutover.sql" > "$ci_root/seed.log" 2>&1; then
  echo 'Synthetic local seed failed; SQL output is withheld' >&2
  exit 1
fi

for migration in \
  20260920120000_public_single_post_prepare.sql \
  20260920121000_public_single_post_cutover.sql \
  20260920122000_project_public_view.sql; do
  if ! psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
    -f "$repo_root/supabase/migrations/$migration" > "$ci_root/$migration.log" 2>&1; then
    echo "LOCAL migration failed: $migration; SQL output is withheld" >&2
    exit 1
  fi
done

for sql_test in \
  "$repo_root/supabase/tests/authz_public_snapshot.sql" \
  "$repo_root/supabase/tests/authz_project_public_view.sql"; do
  name="$(basename "$sql_test")"
  if ! psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$sql_test" > "$ci_root/$name.log" 2>&1; then
    echo "LOCAL authorization SQL test failed: $name; SQL output is withheld" >&2
    exit 1
  fi
  echo "LOCAL authorization SQL test passed: $name"
done

export LOCAL_USERS_FILE="$ci_root/users.json"
node --test "$repo_root/supabase/local-verify/http-authz.test.mjs"
echo 'Local-only Supabase authorization checks passed'
