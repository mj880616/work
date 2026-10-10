import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createQueryClient, DbQueryError } from './db-query.mjs';

export function makePlan(mode, runId, ref) {
  if (!['check', 'tx-probe'].includes(mode) || ref !== 'refs/heads/main'
      || typeof runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runId)) {
    throw new Error('Invalid mode, main ref or run ID');
  }
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

export async function runPlan(plan, query, { secretValues = [] } = {}) {
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
    } catch {
      return { ok: false, summary: '## 연결 확인: 실패\n\n응답·원문 오류는 출력하지 않습니다. environment 설정·토큰 권한 또는 응답 형식을 확인하세요.\n' };
    }
  }
  let cancelled = false;
  let errorCancelled = false;
  let cleanup = '';
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
    } catch {
      cleanup = `수동 정리 필요: \`${plan.probe}\`. 정리 응답을 확인할 수 없습니다.\n`;
    }
  };
  const absent = async () => {
    const rows = await query(plan.sql.verify, { readOnly: true });
    if (rows.length !== 1 || typeof rows[0]?.rolled_back !== 'boolean') throw new Error('Invalid verification');
    return rows[0].rolled_back;
  };
  const result = note => ({ ok: cancelled && errorCancelled, summary:
    `## 트랜잭션 시험\n\n취소 보장: ${cancelled ? '예' : '아니오'}\n\n오류 시 전체 취소: ${errorCancelled ? '예' : '아니오'}\n\n${note}\n\n${cleanup}` });
  try {
    await ddl(plan.sql.cancel);
    cancelled = await absent();
  } catch {
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
  }
  try {
    const tableAbsent = await absent();
    errorCancelled = expectedError && tableAbsent;
    if (!tableAbsent) await removeProbe();
  } catch {
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
  const plan = makePlan(process.env.DB_MODE, process.env.GITHUB_RUN_ID, process.env.GITHUB_REF);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) throw new Error('Missing summary destination');
  if (phase === 'plan') {
    appendFileSync(summaryFile, planSummary(plan));
  } else if (phase === 'run') {
    const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
    const projectRef = process.env.SUPABASE_PROJECT_REF ?? '';
    if (token) process.stdout.write(maskValue(token) + '\n');
    if (projectRef) process.stdout.write(maskValue(projectRef) + '\n');
    const query = createQueryClient({ token, projectRef });
    const result = await runPlan(plan, query, { secretValues: [token, projectRef] });
    appendFileSync(summaryFile, result.summary);
    process.exitCode = result.ok ? 0 : 1;
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
