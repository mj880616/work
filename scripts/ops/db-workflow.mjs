import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createQueryClient, DbQueryError, queryErrorSummary } from './db-query.mjs';
import { prepareMigration, migrationSummary, sqlBlock } from './db-migration-plan.mjs';
import { ExpandedRejection, REJECT_REASONS } from './db-migration-expanded.mjs';
import { runMigrationPlan, buildBackup } from './db-migration-run.mjs';

export function makePlan(mode, runId, ref, version = '', root = process.cwd()) {
  if (!['check', 'tx-probe', 'dry-run', 'apply', 'rollback'].includes(mode) || ref !== 'refs/heads/main'
      || typeof runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runId)) {
    throw new Error('Invalid mode, main ref or run ID');
  }
  if (['dry-run', 'apply', 'rollback'].includes(mode)) {
    // Input: 14-digit version or the migration file name `<version>_<name>.sql`.
    const file = typeof version === 'string' ? version.match(/^([0-9]{14})_([a-z0-9][a-z0-9_]{0,80})\.sql$/) : null;
    const plan = prepareMigration({ mode, version: file ? file[1] : version, runId, root });
    if (file && plan.name !== file[2]) throw new Error('Migration file name does not match');
    buildBackup(plan); // Reject oversized identifiers before environment approval.
    return plan;
  }
  if (version !== '') throw new Error('Version must be blank for check/tx-probe');
  if (mode === 'check') return {
    mode, sql: { check: 'select version,name from supabase_migrations.schema_migrations order by version desc limit 3;' },
  };
  const probe = `private.ops_tx_probe_${runId}`;
  return { mode, probe, sql: {
    cancel: `begin; create table ${probe}(x int); rollback;`,
    verify: `select to_regclass('${probe}') is null as rolled_back;`,
    cleanup: `drop table if exists ${probe};`,
    error: `begin; create table ${probe}(x int); select 1/0; commit;`,
  } };
}

export function planSummary(plan) {
  if (['dry-run', 'apply', 'rollback'].includes(plan.mode)) {
    let summary = migrationSummary(plan);
    if (plan.flow === 'full') summary += fullFlowSummary(plan);
    if (plan.mode !== 'dry-run') {
      const backup = buildBackup(plan);
      summary += '\n### 실행 직전 비공개 백업 (별도 요청; 실패하면 적용 안 함)\n\n' + sqlBlock(backup.sql);
      if (backup.counts) summary += '\n백업 표 이름·행 수 확인 (읽기 전용):\n\n' + sqlBlock(backup.counts);
    }
    return summary;
  }
  const explanation = plan.mode === 'check'
    ? '연결 확인: 최근 migration version/name을 최대 3행만 읽습니다. 쓰기는 없습니다.'
    : '빈 시험 표 1개로 rollback 및 중간 오류의 전체 취소를 시험합니다. 표가 남거나 확인이 불가능하면 같은 표만 정리하고 실패합니다.';
  const steps = plan.mode === 'check' ? [['읽기 전용 1회', plan.sql.check]] : [
    ['요청1: 명시적 취소', plan.sql.cancel], ['요청2: 표 없음 확인', plan.sql.verify],
    ['요청3: 요청2가 false이면 정리 후 실패', plan.sql.cleanup],
    ['요청4: 중간 오류 시험 (요청1·2 통과 시)', plan.sql.error],
    ['요청5: 표 없음 확인', plan.sql.verify],
    ['요청5가 false이거나 확인 불가 시 정리 후 실패', plan.sql.cleanup],
  ];
  return `## DB workflow 1단계: ${plan.mode}\n\n${explanation}\n\n`
    + steps.map(([label, sql]) => `### ${label}\n\n\`\`\`sql\n${sql}\n\`\`\`\n`).join('\n')
    + '\n통신·파싱 실패도 통과로 판정하지 않습니다. 확인 불가 시에도 정리 요청을 1회 시도합니다. 정리 실패는 수동 정리 필요로 표시합니다. 각 HTTP 요청에 재시도는 없습니다.\n';
}

export function fullFlowSummary(plan) {
  const r = plan.review;
  return `\n### 승인 한 번 흐름 (${plan.rules === 'expanded' ? '확장 규칙' : '기존 엄격 규칙'} 통과)\n\n`
    + (plan.mode === 'apply'
      ? '승인 뒤 순서: 사전 기록 없음 확인 → precheck 기대값 검사 → snapshot을 artifact로 저장 → 트랜잭션 안 시험 적용 후 취소·precheck 값 그대로 확인 → 기존 표 백업 → 적용(파일의 begin/commit) → migration 기록 확인 → postcheck(예·expect·사전 값과 같음) 확인. 하나라도 실패하면 멈추고 자동으로 되돌리지 않습니다.\n\n'
      : '승인 뒤 순서: 사전 기록 없음 확인 → precheck 기대값 검사 → snapshot을 artifact로 저장 → 트랜잭션 안 시험 적용 후 취소·precheck 값 그대로 확인. 실제 적용 없음.\n\n')
    + (r ? `검토 표시: 정책 ${r.policies}개(restrictive ${r.restrictive}) · 권한 부여 ${r.grants}개(authenticated·service_role만, 이번 파일의 새 표·함수만) · 트리거 ${r.triggers}개 · 회수 ${r.revokes}개`
      + ` · SECURITY DEFINER 함수 ${r.definer.length ? r.definer.map(n => `\`${n}\``).join(', ') : '없음'}\n\n` : '')
    + `### snapshot (읽기 전용, artifact로 저장)\n\n파일: \`${plan.snapshot.path}\` · SHA256: \`${plan.snapshot.sha256}\`\n\n${sqlBlock(plan.snapshot.sql)}\n`
    + (plan.checks.precheck?.expect?.size ? `precheck expect 주석 ${plan.checks.precheck.expect.size}개, 나머지 항목은 \`예\`여야 합니다.\n\n` : 'precheck 항목은 모두 `예`여야 합니다.\n\n')
    + `rollback 파일(자동 실행 안 함): \`${plan.rollbackPath}\`\n`;
}

export async function runPlan(plan, query, { secretValues = [], saveSnapshot = null } = {}) {
  if (['dry-run', 'apply', 'rollback'].includes(plan.mode)) return runMigrationPlan(plan, query, { secretValues, saveSnapshot });
  if (plan.mode === 'check') {
    try {
      const rows = await query(plan.sql.check, { readOnly: true });
      if (rows.length > 3 || rows.some(row => !row || typeof row !== 'object'
          || !/^[0-9]{14}$/.test(row.version) || typeof row.name !== 'string'
          || !/^[A-Za-z0-9_-]{1,100}$/.test(row.name)
          || secretValues.some(secret => secret && `${row.version} ${row.name}`.includes(secret)))) {
        throw new Error('Invalid migration metadata');
      }
      return { ok: true, summary: '## 연결 확인: 성공\n\n| version | name |\n| --- | --- |\n'
        + rows.map(row => `| ${row.version} | ${row.name} |`).join('\n') + '\n' };
    } catch (error) {
      return { ok: false, summary: `## 연결 확인: 실패\n\n${queryErrorSummary(error)}\n\n쓰기 요청 전송: 아니오. environment 설정·토큰 권한 또는 응답 형식을 확인하세요.\n` };
    }
  }
  let cancelled = false;
  let errorCancelled = false;
  let cleanup = '';
  const failures = [];
  let phase = '명시적 취소 요청';
  const ddl = async sql => {
    const rows = await query(sql);
    // These SQL batches contain no result-bearing successful statement. A
    // nonempty payload cannot attest to successful DDL/ROLLBACK or cleanup.
    if (rows.length !== 0) throw new Error('Unexpected DDL response');
  };
  const removeProbe = async () => {
    try {
      await ddl(plan.sql.cleanup);
      cleanup = `시험 표 정리 요청: 성공 (\`${plan.probe}\`).\n`;
    } catch (error) {
      cleanup = `수동 정리 필요: \`${plan.probe}\`. 정리 응답을 확인할 수 없습니다. ${queryErrorSummary(error)}\n`;
    }
  };
  const absent = async () => {
    const rows = await query(plan.sql.verify, { readOnly: true });
    if (rows.length !== 1 || typeof rows[0]?.rolled_back !== 'boolean') throw new Error('Invalid verification');
    return rows[0].rolled_back;
  };
  const result = note => ({ ok: cancelled && errorCancelled, summary:
    `## 트랜잭션 시험\n\n취소 보장: ${cancelled ? '예' : '아니오'}\n\n오류 시 전체 취소: ${errorCancelled ? '예' : '아니오'}\n\n${note}\n\n시험 쓰기 요청 전송: 예. 요청을 자동 재시도하지 않습니다. 결과 불명 시 커맨드센터에서 시험 표와 정리 결과를 확인하세요.\n\n${failures.join('\n\n')}\n\n${cleanup}` });
  try {
    await ddl(plan.sql.cancel);
    phase = '명시적 취소 후 표 없음 확인';
    cancelled = await absent();
  } catch (error) {
    failures.push(`${phase}: 실패. ${queryErrorSummary(error)}`);
    await removeProbe();
    return result('첫 시험 요청 또는 확인 실패. 취소 여부 미확인; 2단계 진행 불가.');
  }
  if (!cancelled) {
    await removeProbe();
    return result('트랜잭션 취소 미보장. 중간 오류 시험은 실행하지 않았습니다.');
  }
  let expectedError = false;
  try {
    await query(plan.sql.error);
  } catch (error) {
    expectedError = error instanceof DbQueryError && error.divisionByZero;
    if (!expectedError) failures.push(`중간 오류 요청: 실패. ${queryErrorSummary(error)}`);
  }
  try {
    const tableAbsent = await absent();
    errorCancelled = expectedError && tableAbsent;
    if (!tableAbsent) await removeProbe();
  } catch (error) {
    failures.push(`중간 오류 후 표 없음 확인: 실패. ${queryErrorSummary(error)}`);
    await removeProbe();
    return result('중간 오류 후 표 없음 확인 실패. 취소 여부 미확인; 2단계 진행 불가.');
  }
  return result(errorCancelled ? '두 판정 모두 이번 실행에서 통과했습니다. 2단계는 별도 파일·PR·승인이 필요합니다.'
    : '오류 시 전체 취소 미보장 또는 의도한 SQL 오류 미확인. 2단계 진행 불가.');
}

export function maskValue(value) {
  return `::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`;
}

async function main() {
  const phase = process.argv[2];
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) throw new Error('Missing summary destination');
  let plan;
  try {
    plan = makePlan(process.env.DB_MODE, process.env.GITHUB_RUN_ID, process.env.GITHUB_REF, process.env.DB_VERSION ?? '');
  } catch (error) {
    // Fixed reason text only; never the SQL or file content.
    const reason = error instanceof ExpandedRejection ? REJECT_REASONS[error.reason] : '입력·파일 구조·짝 파일 또는 기존 엄격 규칙 위반';
    appendFileSync(summaryFile, `## DB plan 거절\n\n사유: ${reason}\n\n아무 DB 요청도 보내지 않았습니다.\n`);
    throw error;
  }
  if (phase === 'plan') {
    appendFileSync(summaryFile, planSummary(plan));
  } else if (phase === 'run') {
    const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
    const projectRef = process.env.SUPABASE_PROJECT_REF ?? '';
    if (token) process.stdout.write(maskValue(token) + '\n');
    if (projectRef) process.stdout.write(maskValue(projectRef) + '\n');
    const query = createQueryClient({ token, projectRef });
    const snapshotDir = process.env.DB_SNAPSHOT_DIR ?? '';
    const saveSnapshot = snapshotDir ? async (fileName, body) => {
      if (!/^[0-9]{14}_[a-z0-9_]+\.snapshot\.json$/.test(fileName)) throw new Error('Invalid snapshot name');
      mkdirSync(snapshotDir, { recursive: true });
      writeFileSync(join(snapshotDir, fileName), body, { flag: 'wx' });
    } : null;
    const result = await runPlan(plan, query, { secretValues: [token, projectRef], saveSnapshot });
    appendFileSync(summaryFile, result.summary);
    process.exitCode = result.ok && result.verification !== 'incomplete' ? 0 : 1;
  } else {
    throw new Error('Invalid phase');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // No stack, SQL, credentials or response data in stdout/stderr.
    process.stderr.write('DB workflow failed; see the bounded job summary.\n');
    process.exitCode = 1;
  });
}
