import { createHash } from 'node:crypto';
import { toDryRun, escapeSummary } from './db-migration-plan.mjs';
import { meetsExpectation, expectationFor } from './db-migration-expanded.mjs';
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
  if (typeof value !== 'string' || !/^[\p{L}\p{N} _/()=:+.,·-]{1,100}$/u.test(value)
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

// --- Full single-approval flow (DB-승인형확장) ---------------------------------
// Values that are not plain aggregates are never printed: the public job summary
// shows a short SHA-256 instead, and comparisons use the in-memory raw value.
const shortHash = value => '#' + createHash('sha256').update(value).digest('hex').slice(0, 16);
const display = value => aggregate(value) ? escapeSummary(value) : shortHash(value);
function rawObservations(rows, secretValues, keys) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 64) throw new Error('Invalid check size');
  const result = new Map();
  for (const row of rows) {
    const key = keys.find(k => onlyKeys(row, ['item', k]));
    if (!key) throw new Error('Invalid check shape');
    let value = row[key];
    if (value === true || value === false) value = value ? '예' : '아니오';
    if (value === null) value = 'NULL';
    if (typeof value !== 'string' || value.length > 65_536
        || secretValues.some(secret => secret && value.includes(secret))) throw new Error('Unsafe check value');
    safeLabel(row.item, secretValues);
    if (result.has(row.item)) throw new Error('Duplicate check item');
    result.set(row.item, value);
  }
  return result;
}
const SNAPSHOT_MAX_ROWS = 2000;
function snapshotRows(rows, secretValues) {
  if (!Array.isArray(rows) || rows.length > SNAPSHOT_MAX_ROWS) throw new Error('Invalid snapshot size');
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 8) throw new Error('Invalid snapshot row');
    for (const [key, value] of Object.entries(row)) {
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(key)) throw new Error('Invalid snapshot column');
      if (!(value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' && value.length <= 8192)
          || typeof value === 'string' && secretValues.some(secret => secret && value.includes(secret))) throw new Error('Unsafe snapshot value');
    }
  }
  return rows;
}
export function rollbackGuide(plan, snapshotName) {
  return '### 되돌리기 (자동 실행 안 함 — 사용자 결정)\n\n'
    + `1. 커맨드센터가 이 실행의 snapshot artifact${snapshotName ? ` \`${snapshotName}\`` : ''}와 \`${plan.rollbackPath ?? `docs/${plan.version}_${plan.name}.rollback.sql`}\`를 대조합니다.\n`
    + '2. 되돌리기로 결정하면 rollback 파일을 SQL Editor 새 창(+)에 붙여 넣고 첫 줄 `begin;`·마지막 줄 `commit;`을 확인한 뒤 실행합니다. '
    + '(rollback 파일이 workflow rollback 규칙을 통과하는 경우에만 mode `rollback`도 가능)\n'
    + '3. 실행 뒤 같은 postcheck를 SQL Editor에서 돌려 되돌림을 확인합니다. 백업 표는 자동 삭제하지 않습니다.\n';
}

export async function runFullPlan(plan, query, { secretValues = [], saveSnapshot = null } = {}) {
  const notes = [`## DB ${plan.mode} (승인 한 번 흐름): ${plan.version}\n`];
  const steps = [];
  let writeRequested = false; let executed = false; let applied = false; let snapshotName = null;
  let phase = '사전 기록 확인';
  const historyCount = async (matchName = false) => {
    const rows = await query(`select count(*)::int as count from supabase_migrations.schema_migrations where version='${plan.version}'${matchName ? ` and name='${plan.name}'` : ''};`, { readOnly: true });
    if (rows.length !== 1 || !onlyKeys(rows[0], ['count']) || !Number.isSafeInteger(rows[0].count) || rows[0].count < 0) throw new Error('Invalid history count');
    return rows[0].count;
  };
  const write = async sql => {
    writeRequested = true;
    const rows = await query(sql);
    if (rows.length !== 0) throw new Error('Unexpected write response');
  };
  const stop = reason => {
    steps.push(`멈춤: ${reason}`);
    return finish(false);
  };
  const finish = ok => {
    let text = notes.join('\n\n') + '\n\n### 진행\n\n' + steps.map(step => `- ${step}`).join('\n') + '\n\n';
    text += `쓰기 요청 전송: ${writeRequested ? '예' : '아니오'} · 적용 요청 전송: ${executed ? '예' : '아니오'}\n\n`;
    if (plan.mode === 'apply' && (applied || executed)) text += rollbackGuide(plan, snapshotName);
    if (!ok && writeRequested && !applied) text += '\n요청을 자동 재시도하지 않습니다. 결과를 커맨드센터에서 확인한 뒤 다음 단계를 정합니다.\n';
    return { ok, verification: ok ? 'complete' : 'incomplete', summary: text };
  };
  try {
    const count = await historyCount();
    if (count !== 0) return stop('이미 적용된 version입니다(사전 기록 있음). 아무것도 쓰지 않았습니다.');
    steps.push('사전 기록 없음: 예');

    phase = '사전 확인(precheck)';
    const pre = rawObservations(await query(plan.checks.precheck.sql, { readOnly: true }), secretValues, ['value']);
    const expect = plan.checks.precheck.expect ?? new Map();
    let prePassed = true;
    const preLines = [...pre].map(([item, value]) => {
      const expected = expectationFor(expect, item) ?? '예';
      const ok = meetsExpectation(value, expected); prePassed &&= ok;
      return `| ${safeLabel(item, secretValues)} | ${display(value)} | ${escapeSummary(expected)} | ${ok ? '예' : '아니오'} |`;
    });
    const missing = [...expect.keys()].filter(item => !item.endsWith(' *') && !pre.has(item));
    if (missing.length) prePassed = false;
    notes.push('사전 확인:\n\n| 항목 | 값 | 기대 | 판정 |\n| --- | --- | --- | --- |\n' + preLines.join('\n')
      + (missing.length ? `\n\n기대 주석에 있으나 결과에 없는 항목: ${missing.length}개` : ''));
    if (!prePassed) return stop('사전 확인이 기대와 다릅니다. 아무것도 쓰지 않았습니다.');
    steps.push('사전 확인 기대값: 예');

    phase = '상태 저장(snapshot)';
    const rows = snapshotRows(await query(plan.snapshot.sql, { readOnly: true }), secretValues);
    const body = JSON.stringify({ version: plan.version, name: plan.name, run_id: plan.runId, snapshot_sha256: plan.snapshot.sha256, rows }, null, 1) + '\n';
    const digest = createHash('sha256').update(body).digest('hex');
    snapshotName = `db-snapshot-${plan.runId}`;
    if (!saveSnapshot && plan.mode === 'apply') return stop('snapshot 저장 위치가 없어 적용하지 않았습니다.');
    if (saveSnapshot) await saveSnapshot(`${plan.version}_${plan.name}.snapshot.json`, body);
    steps.push(`상태 저장: ${rows.length}행 · SHA256 \`${digest}\` · artifact \`${snapshotName}\` (시스템 카탈로그만, 행 값 없음)`);

    phase = '시험 적용(dry-run)';
    executed = plan.mode === 'dry-run';
    await write(toDryRun(plan.file.sql));
    if (await historyCount() !== 0) throw new Error('Dry-run left history');
    const again = rawObservations(await query(plan.checks.precheck.sql, { readOnly: true }), secretValues, ['value']);
    if (again.size !== pre.size || [...pre].some(([item, value]) => again.get(item) !== value)) {
      return stop('시험 적용 뒤 사전 확인 값이 달라졌습니다(취소가 보장되지 않음). 실제 적용하지 않았습니다.');
    }
    steps.push('시험 적용(트랜잭션 안 적용 후 취소): 성공 · 기록 없음 · 사전 확인 값 그대로');
    if (plan.mode === 'dry-run') {
      if (plan.checks.dryRunPostcheck) {
        phase = 'dry-run 원래 상태 검사';
        const dry = rawObservations(await query(plan.checks.dryRunPostcheck.sql, { readOnly: true }), secretValues, ['expected', 'ok', 'value']);
        if ([...dry.values()].some(v => v !== '예')) return stop('dry-run 원래 상태 검사 실패.');
        steps.push('dry-run 원래 상태 검사: 예');
      }
      steps.push('dry-run 끝. 실제 적용은 mode `apply`로 새 실행·승인이 필요합니다.');
      return finish(true);
    }

    phase = '백업';
    const backup = buildBackup(plan);
    steps.push('백업 표(요청 대상): ' + (backup.tables.map(t => `\`ops_backup.${t.name}\``).join(', ') || '대상 기존 public 표 없음'));
    if (backup.tables.length) {
      await write(backup.sql);
      const counts = await query(backup.counts, { readOnly: true });
      if (counts.length !== backup.tables.length) throw new Error('Invalid backup counts');
      for (const t of backup.tables) {
        const row = counts.find(r => r?.table_name === t.name);
        if (!onlyKeys(row, ['table_name', 'row_count']) || typeof row.row_count !== 'string' || !/^\d{1,20}$/.test(row.row_count)) throw new Error('Invalid backup count');
        steps.push(`백업 확인: ops_backup.${t.name} ${row.row_count}행`);
      }
    }

    phase = '적용';
    executed = true;
    await write(plan.file.sql);
    applied = true;
    if (await historyCount(true) !== 1) throw new Error('Unexpected post-history');
    steps.push('적용: 성공 · migration 기록 1행');

    phase = '사후 확인(postcheck)';
    const post = rawObservations(await query(plan.checks.postcheck.sql, { readOnly: true }), secretValues, ['ok', 'expected', 'value']);
    const postExpect = plan.checks.postcheck.expect ?? new Map();
    let postPassed = true;
    const postLines = [...post].map(([item, value]) => {
      let basis; let ok;
      const wanted = expectationFor(postExpect, item);
      if (wanted !== undefined) { basis = `기대 ${wanted}`; ok = meetsExpectation(value, wanted); }
      else if (['예', '아니오'].includes(value)) { basis = '예'; ok = value === '예'; }
      else if (pre.has(item)) { basis = '사전 값과 같음'; ok = pre.get(item) === value; }
      else { basis = '비교 기준 없음'; ok = false; }
      postPassed &&= ok;
      return `| ${safeLabel(item, secretValues)} | ${display(value)} | ${escapeSummary(basis)} | ${ok ? '예' : '아니오'} |`;
    });
    notes.push('사후 확인:\n\n| 항목 | 값 | 기준 | 판정 |\n| --- | --- | --- | --- |\n' + postLines.join('\n'));
    if (!postPassed) return stop('사후 확인 실패. 이미 적용된 변경은 자동으로 되돌리지 않습니다. 아래 되돌리기 안내를 보고 결정하세요.');
    steps.push('사후 확인: 모두 예');
    return finish(true);
  } catch (error) {
    steps.push(`${phase}: 실패. ${queryErrorSummary(error)}`);
    return finish(false);
  }
}

export async function runMigrationPlan(plan, query, { secretValues = [], saveSnapshot = null } = {}) {
  if (plan.flow === 'full' && ['dry-run', 'apply'].includes(plan.mode)) return runFullPlan(plan, query, { secretValues, saveSnapshot });
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
