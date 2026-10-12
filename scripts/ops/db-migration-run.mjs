import { toDryRun, escapeSummary } from './db-migration-plan.mjs';
import { queryErrorSummary } from './db-query.mjs';

export function buildBackup(plan) {
  const tables = plan.targets.map(source => {
    const name = `${plan.version}_${source}_${plan.runId}`;
    if (!/^[0-9]{14}_[a-z_][a-z0-9_]*_[1-9][0-9]*$/.test(name) || name.length > 63) throw new Error('Invalid backup name');
    return { source, name };
  });
  const sql = 'begin;\nset local lock_timeout = \'5s\';\nset local statement_timeout = \'60s\';\n'
    + 'create schema if not exists ops_backup;\nrevoke all on schema ops_backup from public, anon, authenticated;\n'
    + (tables.length ? `lock table ${tables.map(t => `public.${t.source}`).join(', ')} in share mode;\n` : '')
    + tables.map(t => `create table ops_backup."${t.name}" as select * from public.${t.source};\nrevoke all on table ops_backup."${t.name}" from public, anon, authenticated;\n`).join('')
    + 'commit;\n';
  const counts = tables.length ? tables.map(t => `select '${t.name}' as table_name, count(*)::text as row_count from ops_backup."${t.name}"`).join('\nunion all\n') + ';' : null;
  return { tables, sql, counts };
}

function safeLabel(value, secretValues) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N} _/()=:+.-]{1,100}$/u.test(value)
      || secretValues.some(secret => secret && value.includes(secret))) throw new Error('Unsafe check label');
  return escapeSummary(value);
}
const aggregate = value => typeof value === 'string' && value.length <= 128
  && (/^-?\d+(?:[/:]\d+)*(?::[a-f0-9]{32,64})?$/.test(value)
      || /^[a-f0-9]{32,64}$/.test(value) || /^(?:예|아니오|true|false)$/.test(value)
      || /^\d{14}:[a-z0-9_]+(?: \/ \d{14}:[a-z0-9_]+){0,2}$/.test(value));
const onlyKeys = (row, keys) => row && typeof row === 'object' && !Array.isArray(row)
  && Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
function observations(rows, secretValues) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 64) throw new Error('Invalid precheck size');
  const result = new Map();
  for (const row of rows) {
    if (!onlyKeys(row, ['item', 'value']) || !aggregate(row.value)
        || secretValues.some(secret => secret && row.value.includes(secret))) throw new Error('Unsafe precheck value');
    safeLabel(row.item, secretValues);
    if (result.has(row.item)) throw new Error('Duplicate check item');
    result.set(row.item, row.value);
  }
  return result;
}

export async function runMigrationPlan(plan, query, { secretValues = [] } = {}) {
  const notes = [`## DB ${plan.mode}: ${plan.version}\n`];
  let executed = false;
  let writeRequested = false;
  let baseline;
  let verification = 'incomplete';
  let phase = '사전 기록 확인';
  const historyCount = async (matchName = false) => {
    const rows = await query(`select count(*)::int as count from supabase_migrations.schema_migrations where version='${plan.version}'${matchName ? ` and name='${plan.name}'` : ''};`, { readOnly: true });
    if (rows.length !== 1 || !onlyKeys(rows[0], ['count']) || !Number.isSafeInteger(rows[0].count) || rows[0].count < 0) throw new Error('Invalid history count');
    return rows[0].count;
  };
  const ddl = async sql => {
    writeRequested = true;
    const rows = await query(sql);
    if (rows.length !== 0) throw new Error('Unexpected write response');
  };
  try {
    const count = await historyCount(plan.mode === 'rollback');
    if (plan.mode === 'rollback' ? count !== 1 : count !== 0) {
      notes.push('사전 기록 확인: 거부. 적용·시험은 미적용 version만, rollback은 해당 version/name 1행이 있어야 합니다.');
      return { ok: false, summary: notes.join('\n\n') + '\n' };
    }
    if (plan.checks.precheck && !plan.checks.precheck.baselineNull) {
      phase = '사전 집계 확인';
      const rows = await query(plan.checks.precheck.sql, { readOnly: true });
      // Validate every row before emitting any: malformed responses cannot leak
      // earlier rows. Only operational counts/hashes/metadata are printable.
      baseline = observations(rows, secretValues);
      const lines = [...baseline].map(([item, value]) => `| ${safeLabel(item, secretValues)} | ${escapeSummary(value)} |`);
      notes.push('사전 집계:\n\n| item | value |\n| --- | --- |\n' + lines.join('\n'));
    } else if (plan.checks.precheck?.baselineNull) {
      notes.push('사전 집계: 수동 확인 필요 (baseline NULL). SQL을 실행하지 않았습니다.');
    }
    if (plan.mode !== 'dry-run') {
      phase = '백업';
      const backup = buildBackup(plan);
      // Predict names before the write so a lost response still leaves a
      // recovery pointer. Never log source data or delete failed-run backups.
      notes.push('백업 표(요청 대상): ' + (backup.tables.map(t => `\`ops_backup.${t.name}\``).join(', ') || '대상 public 표 없음'));
      await ddl(backup.sql);
      if (backup.counts) {
        const rows = await query(backup.counts, { readOnly: true });
        if (rows.length !== backup.tables.length || new Set(rows.map(r => r?.table_name)).size !== rows.length) throw new Error('Invalid backup counts');
        const lines = backup.tables.map(t => {
          const row = rows.find(r => r?.table_name === t.name);
          if (!onlyKeys(row, ['table_name', 'row_count']) || typeof row.row_count !== 'string' || !/^\d{1,20}$/.test(row.row_count)) throw new Error('Invalid backup count');
          return `| ops_backup.${t.name} | ${row.row_count} |`;
        });
        notes.push('백업 확인:\n\n| 표 | 행 수 |\n| --- | --- |\n' + lines.join('\n'));
      }
    }
    phase = '실행';
    executed = true;
    await ddl(plan.mode === 'dry-run' ? toDryRun(plan.file.sql) : plan.file.sql);
    notes.push(plan.mode === 'dry-run' ? 'dry-run SQL 취소: 완료' : `${plan.mode}: 성공`);
    phase = '사후 기록 확인';
    const after = await historyCount(plan.mode === 'apply');
    if (after !== (plan.mode === 'apply' ? 1 : 0)) throw new Error('Unexpected post-history');
    notes.push('사후 migration 기록: 예');
    if (plan.mode === 'dry-run' && baseline) {
      phase = 'dry-run 사전 집계 재확인';
      const afterObservations = observations(await query(plan.checks.precheck.sql, { readOnly: true }), secretValues);
      if (baseline.size !== afterObservations.size || [...baseline].some(([item, value]) => afterObservations.get(item) !== value)) {
        throw new Error('Changed precheck observations');
      }
      verification = 'complete';
      notes.push('사전 집계 관측값 보존: 예. DB 전체 자료의 동일성을 증명하지 않습니다.');
    }
    const postcheck = plan.mode === 'dry-run' ? plan.checks.dryRunPostcheck : plan.checks.postcheck;
    if (postcheck) {
      if (postcheck.baselineNull) {
        verification = 'incomplete';
        notes.push('사후 검사: 수동 확인 필요 (baseline NULL). SQL을 실행하지 않았습니다.');
      }
      else {
        phase = plan.mode === 'dry-run' ? 'dry-run 원래 상태 검사' : '사후 검사';
        const rows = await query(postcheck.sql, { readOnly: true });
        if (!rows.length || rows.length > 64) throw new Error('Invalid postcheck size');
        let passed = true;
        const lines = rows.map(row => {
          const key = ['expected', 'ok', 'value'].find(key => onlyKeys(row, ['item', key]));
          if (!key || ![true, false, '예', '아니오'].includes(row[key])) throw new Error('Invalid postcheck verdict');
          const yes = row[key] === true || row[key] === '예'; passed &&= yes;
          return `| ${safeLabel(row.item, secretValues)} | ${yes ? '예' : '아니오'} |`;
        });
        notes.push('사후 검사:\n\n| 항목 | 판정 |\n| --- | --- |\n' + lines.join('\n'));
        if (!passed) return { ok: false, summary: notes.join('\n\n') + (plan.mode === 'dry-run'
          ? '\n\ndry-run 원래 상태 검사 실패. SQL 취소와 migration 기록 부재만 확인됐습니다. snapshot을 대조한 뒤 진행 여부를 결정하세요.\n'
          : '\n\n사후 검사 실패. 이미 실행한 변경은 자동 취소하지 않습니다.\n') };
      }
    }
    if (plan.mode === 'dry-run') {
      if (plan.manualSnapshotRequired) {
        verification = 'incomplete';
        notes.push('기존 baseline NULL: 수동 확인 필요. snapshot 대조 요구를 유지합니다.');
      }
      if (verification === 'incomplete') notes.push('dry-run 검증 미완료: 수동 snapshot 확인 필요. SQL 취소·migration 기록 부재와 원래 상태 검증은 별개입니다. 수동 대조 전 apply로 진행하지 마세요.');
      else notes.push('dry-run 사후 검증: 완료. 관측한 집계·선택된 원래 상태 검사 범위만 확인했습니다.');
      return { ok: true, verification, summary: notes.join('\n\n') + '\n' };
    }
    return { ok: true, summary: notes.join('\n\n') + '\n' };
  } catch (error) {
    notes.push(`${phase}: 실패. ${queryErrorSummary(error)}`);
    notes.push(`쓰기 요청 전송: ${writeRequested ? '예' : '아니오'} · 실행 요청 전송: ${executed ? '예' : '아니오'}`);
    notes.push(writeRequested ? '요청을 자동 재시도하지 않습니다. 쓰기 요청 결과를 커맨드센터에서 확인한 뒤 복구 여부를 결정하세요.' : '적용 요청을 보내지 않았습니다.');
    return { ok: false, summary: notes.join('\n\n') + '\n' };
  }
}
