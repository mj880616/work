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
cp -R "$repo_root/supabase/functions/_shared" "supabase/functions/_shared"
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

if [[ "${WEB2_TASK13:-0}" == 1 ]]; then
  task13_migration=20260925143746_task13_web2_private_boundary.sql
  task13_fingerprint="$repo_root/supabase/local-verify/task13-fingerprint.sql"
  task13_rollback="$repo_root/scripts/sql/rollback/$task13_migration"

  psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -f "$task13_fingerprint" \
    > "$ci_root/task13-before.hash" 2> "$ci_root/task13-before.err"

  apply_task13_migration() {
    local phase="$1" path="$repo_root/supabase/migrations/$task13_migration"
    psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
      -f "$path" > "$ci_root/task13-${phase}-migration.log" 2>&1 || {
        node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" MIGRATION "$path" "$ci_root/task13-${phase}-migration.log"
        echo "TASK13_MIGRATION_FAILED: $phase; SQL output withheld" >&2; exit 1;
      }
  }
  run_task13_test() {
    local phase="$1"
    for sql_test in authz_sole_owner.sql authz_task13_private_boundary.sql; do
      local path="$repo_root/supabase/tests/$sql_test"
      psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
        -f "$path" > "$ci_root/task13-${phase}-${sql_test}.log" 2>&1 || {
          node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" AUTHORIZATION_SQL "$path" "$ci_root/task13-${phase}-${sql_test}.log"
          echo "TASK13_ACTOR_MATRIX_FAILED: $phase/$sql_test; SQL output withheld" >&2; exit 1;
        }
    done
  }

  apply_task13_migration forward
  run_task13_test forward
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$task13_rollback" > "$ci_root/task13-rollback.log" 2>&1 || {
      node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" ROLLBACK "$task13_rollback" "$ci_root/task13-rollback.log"
      echo 'TASK13_ROLLBACK_FAILED: SQL output withheld' >&2; exit 1;
    }
  psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -f "$task13_fingerprint" \
    > "$ci_root/task13-after.hash" 2> "$ci_root/task13-after.err"
  cmp -s "$ci_root/task13-before.hash" "$ci_root/task13-after.hash" || {
    echo 'TASK13_ROLLBACK_FAILED: authorization fingerprint changed' >&2; exit 1;
  }
  echo 'TASK13_ROLLBACK_PASSED'

  apply_task13_migration reapply
  run_task13_test reapply
  echo 'TASK13_REAPPLY_PASSED'
  exit 0
fi

if [[ "${WEB2_TASK12A:-0}" == 1 ]]; then
  task12a_migration=20260925084844_task12a_sole_owner_db.sql
  fingerprint="$repo_root/supabase/local-verify/task12a-fingerprint.sql"
  rollback_path="$repo_root/scripts/sql/rollback/$task12a_migration"

  # A blank local Supabase stack contributes default anon/authenticated ACLs
  # that are absent from the hosted production snapshot. Normalize the
  # disposable baseline with the reviewed rollback before fingerprinting it.
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$rollback_path" > "$ci_root/task12a-baseline-normalize.log" 2>&1 || {
      node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" ROLLBACK "$rollback_path" "$ci_root/task12a-baseline-normalize.log"
      echo 'TASK12A_BASELINE_NORMALIZE_FAILED: SQL output withheld' >&2; exit 1;
    }
  echo 'TASK12A_BASELINE_NORMALIZED'

  psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -f "$fingerprint" \
    > "$ci_root/task12a-before.hash" 2> "$ci_root/task12a-before.err"
  apply_local_migration() {
    local path="$repo_root/supabase/migrations/$task12a_migration"
    psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
      -f "$path" > "$ci_root/task12a-migration.log" 2>&1 || {
        node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" MIGRATION "$path" "$ci_root/task12a-migration.log"
        echo 'TASK12A_MIGRATION_FAILED: SQL output withheld' >&2; exit 1;
      }
  }
  run_task12a_tests() {
    local phase="$1"
    for sql_test in authz_sole_owner.sql authz_project_owner_only.sql; do
      local path="$repo_root/supabase/tests/$sql_test"
      psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
        -f "$path" > "$ci_root/${phase}-${sql_test}.log" 2>&1 || {
          node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" AUTHORIZATION_SQL "$path" "$ci_root/${phase}-${sql_test}.log"
          echo "TASK12A_ACTOR_MATRIX_FAILED: $phase/$sql_test; SQL output withheld" >&2; exit 1;
        }
    done
  }

  apply_local_migration
  run_task12a_tests forward
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$rollback_path" > "$ci_root/task12a-rollback.log" 2>&1 || {
      node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" ROLLBACK "$rollback_path" "$ci_root/task12a-rollback.log"
      echo 'TASK12A_ROLLBACK_FAILED: SQL output withheld' >&2; exit 1;
    }
  psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -f "$fingerprint" \
    > "$ci_root/task12a-after.hash" 2> "$ci_root/task12a-after.err"
  cmp -s "$ci_root/task12a-before.hash" "$ci_root/task12a-after.hash" || {
    changed_components=''
    while IFS='=' read -r component before_hash; do
      after_hash="$(awk -F= -v key="$component" '$1 == key { print $2 }' "$ci_root/task12a-after.hash")"
      if [[ "$before_hash" != "$after_hash" ]]; then
        changed_components="${changed_components}${changed_components:+,}${component}"
      fi
    done < "$ci_root/task12a-before.hash"
    echo "TASK12A_ROLLBACK_CHANGED_COMPONENTS=${changed_components:-unknown}" >&2
    echo 'TASK12A_ROLLBACK_FAILED: authorization fingerprint changed' >&2; exit 1;
  }
  echo 'TASK12A_ROLLBACK_PASSED'

  apply_local_migration
  run_task12a_tests reapply
  echo 'TASK12A_REAPPLY_PASSED'
  exit 0
fi

if [[ "${WEB2_SEED_DIAGNOSTIC:-0}" == 1 ]]; then
  if ! psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -f "$repo_root/supabase/local-verify/seed-catalog.sql" \
    > "$ci_root/seed-catalog.json" 2> "$ci_root/seed-catalog.err"; then
    echo 'SEED_CATALOG_FAILED: SQL output withheld' >&2
    exit 1
  fi
  node "$repo_root/supabase/local-verify/seed-catalog.mjs" \
    "$ci_root/seed-catalog.json" "$repo_root/supabase/local-verify/seed-before-cutover.sql"
fi

if ! PGOPTIONS='-c app.local_verification=on' psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
  -f "$repo_root/supabase/local-verify/custom-auth-trigger.sql" > "$ci_root/auth-trigger.log" 2>&1; then
  node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" AUTH_TRIGGER \
    "$repo_root/supabase/local-verify/custom-auth-trigger.sql" "$ci_root/auth-trigger.log"
  echo 'Local custom Auth trigger setup failed; SQL output is withheld' >&2
  exit 1
fi
node "$repo_root/supabase/local-verify/create-local-auth.mjs" "$ci_root/users.json"
if ! PGOPTIONS='-c app.local_verification=on' psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
  -v VERBOSITY=verbose -v SHOW_CONTEXT=errors \
  -f "$repo_root/supabase/local-verify/seed-before-cutover.sql" > "$ci_root/seed.log" 2>&1; then
  node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" SYNTHETIC_SEED \
    "$repo_root/supabase/local-verify/seed-before-cutover.sql" "$ci_root/seed.log"
  echo 'Synthetic local seed failed; SQL output is withheld' >&2
  exit 1
fi

if [[ "${WEB2_SEED_DIAGNOSTIC:-0}" == 1 ]]; then
  echo 'SYNTHETIC_SEED_DIAGNOSTIC_PASSED: migrations and authorization tests deliberately not started'
  exit 0
fi

apply_local_rollback() {
  local phase="$1" path="$repo_root/scripts/sql/rollback/$1" log="$ci_root/rollback-$1.log"
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$path" > "$log" 2>&1; then
    node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" ROLLBACK "$path" "$log"
    echo "LOCAL_ROLLBACK_FAILED: $phase; SQL output withheld" >&2
    exit 1
  fi
  echo "LOCAL_ROLLBACK_PASSED: $phase"
}

apply_local_migration() {
  local migration="$1" path="$repo_root/supabase/migrations/$1" log="$ci_root/migration-$1.log"
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$path" > "$log" 2>&1; then
    node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" MIGRATION "$path" "$log"
    echo "LOCAL_MIGRATION_FAILED: $migration; SQL output withheld" >&2
    exit 1
  fi
  echo "LOCAL_MIGRATION_PASSED: $migration"
}

run_local_sql_check() {
  local name="$1" path="$repo_root/$1" log="$ci_root/check-${1##*/}.log"
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$path" > "$log" 2>&1; then
    node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" AUTHORIZATION_SQL "$path" "$log"
    echo "LOCAL_SQL_CHECK_FAILED: ${name##*/}; SQL output withheld" >&2
    exit 1
  fi
  echo "LOCAL_SQL_CHECK_PASSED: ${name##*/}"
}

if [[ "${WEB2_TRANSITION:-0}" == 1 ]]; then
  prepare=20260920120000_public_single_post_prepare.sql
  project=20260920121000_project_public_view.sql
  cutover=20260920122000_public_single_post_cutover.sql

  run_local_sql_check supabase/local-verify/transition-legacy.sql
  psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -f "$repo_root/supabase/local-verify/transition-legacy-fingerprint.sql" \
    > "$ci_root/legacy-a.hash" 2> "$ci_root/legacy-a.err"
  WEB2_TRANSITION_STAGE=A node --test "$repo_root/supabase/local-verify/http-transition.test.mjs"
  echo 'TRANSITION_A_PASSED'

  apply_local_migration "$prepare"
  apply_local_migration "$project"
  run_local_sql_check supabase/local-verify/transition-legacy.sql
  run_local_sql_check supabase/local-verify/transition-additive.sql
  psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -f "$repo_root/supabase/local-verify/transition-legacy-fingerprint.sql" \
    > "$ci_root/legacy-b.hash" 2> "$ci_root/legacy-b.err"
  cmp -s "$ci_root/legacy-a.hash" "$ci_root/legacy-b.hash" || {
    echo 'TRANSITION_B_FAILED: legacy policy/grant fingerprint changed' >&2; exit 1;
  }
  WEB2_TRANSITION_STAGE=B node --test "$repo_root/supabase/local-verify/http-transition.test.mjs"
  echo 'TRANSITION_B_PASSED'

  # Rehearse the only safe rollback before contract: additive APIs in reverse order.
  apply_local_rollback "$project"
  apply_local_rollback "$prepare"
  run_local_sql_check supabase/local-verify/transition-legacy.sql
  apply_local_migration "$prepare"
  apply_local_migration "$project"

  node --test "$repo_root/scripts/public-page-meta.test.mjs"
  run_local_sql_check supabase/local-verify/transition-legacy.sql
  run_local_sql_check supabase/local-verify/transition-additive.sql
  WEB2_TRANSITION_STAGE=C node --test "$repo_root/supabase/local-verify/http-transition.test.mjs"
  echo 'TRANSITION_C_PASSED'

  apply_local_migration "$cutover"
  for sql_test in authz_public_snapshot.sql authz_project_public_view.sql authz_definer_helpers.sql; do
    run_local_sql_check "supabase/tests/$sql_test"
  done
  export LOCAL_USERS_FILE="$ci_root/users.json"
  d_http_failed=0
  if ! node --test "$repo_root/supabase/local-verify/http-authz.test.mjs"; then
    node "$repo_root/supabase/local-verify/diagnose-edge.mjs" run || true
    d_http_failed=1
    echo 'TRANSITION_D_HTTP_FAILED: safe post-contract rollback will still be verified' >&2
  else
    echo 'TRANSITION_D_PASSED'
  fi

  # After contract, do not restore broad anon SELECT or run prepare rollback.
  # Always collect this result independently, even when D HTTP verification fails.
  apply_local_rollback "$cutover"
  apply_local_rollback "$project"
  run_local_sql_check supabase/tests/authz_safe_rollback.sql
  echo 'TRANSITION_POST_CONTRACT_SAFE_ROLLBACK_PASSED'
  if [[ "$d_http_failed" == 1 ]]; then
    exit 1
  fi
  exit 0
fi

for migration in \
  20260920120000_public_single_post_prepare.sql \
  20260920121000_project_public_view.sql \
  20260920122000_public_single_post_cutover.sql; do
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$repo_root/supabase/migrations/$migration" > "$ci_root/$migration.log" 2>&1; then
    node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" MIGRATION \
      "$repo_root/supabase/migrations/$migration" "$ci_root/$migration.log"
    echo "LOCAL migration failed: $migration; SQL output is withheld" >&2
    exit 1
  fi
  if [[ "${WEB2_PREDEPLOY:-0}" == 1 && "$migration" == 20260920120000_public_single_post_prepare.sql ]]; then
    apply_local_rollback "$migration"
    # Restore the additive reader grant before the guarded cutover.
    if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
      -f "$repo_root/supabase/migrations/$migration" > "$ci_root/reapply-$migration.log" 2>&1; then
      echo 'LOCAL_PREPARE_REAPPLY_FAILED: SQL output withheld' >&2
      exit 1
    fi
  fi
  if [[ "${WEB2_PREDEPLOY:-0}" == 1 && "$migration" == 20260920122000_public_single_post_cutover.sql ]]; then
    apply_local_rollback "$migration"
  fi
done

for sql_test in \
  "$repo_root/supabase/tests/authz_public_snapshot.sql" \
  "$repo_root/supabase/tests/authz_project_public_view.sql" \
  "$repo_root/supabase/tests/authz_definer_helpers.sql"; do
  name="$(basename "$sql_test")"
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$sql_test" > "$ci_root/$name.log" 2>&1; then
    node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" AUTHORIZATION_SQL \
      "$sql_test" "$ci_root/$name.log"
    echo "LOCAL authorization SQL test failed: $name; SQL output is withheld" >&2
    exit 1
  fi
  echo "LOCAL authorization SQL test passed: $name"
done

export LOCAL_USERS_FILE="$ci_root/users.json"
if [[ "${WEB2_EDGE_DIAGNOSTIC:-0}" == 1 ]]; then
  node "$repo_root/supabase/local-verify/diagnose-edge.mjs" run
  exit $?
fi
if ! node --test "$repo_root/supabase/local-verify/http-authz.test.mjs"; then
  node "$repo_root/supabase/local-verify/diagnose-edge.mjs" run
  exit 1
fi
echo 'Local-only Supabase authorization checks passed'
if [[ "${WEB2_PREDEPLOY:-0}" == 1 ]]; then
  apply_local_rollback 20260920121000_project_public_view.sql
  rollback_test="$repo_root/supabase/tests/authz_safe_rollback.sql"
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
    -f "$rollback_test" > "$ci_root/authz-safe-rollback.log" 2>&1; then
    node "$repo_root/supabase/local-verify/analyze-sql-failure.mjs" ROLLBACK_CHECK \
      "$rollback_test" "$ci_root/authz-safe-rollback.log"
    echo 'LOCAL_ROLLBACK_CHECK_FAILED: SQL output withheld' >&2
    exit 1
  fi
  echo 'LOCAL_ROLLBACK_PUBLIC_URLS_PASSED'
fi
