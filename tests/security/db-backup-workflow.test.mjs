// OPS-DB백업: 매일 백업·월 되살리기 시험 workflow와 도우미(scripts/ops/backup-db.mjs)의 안전 규칙을 고정한다.
// 설계 docs/design/db-backup.md 3-3절(공개 저장소라서 지키는 것).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  SCHEMAS, checkConfig, missingConfig, planRetention, tokenDaysLeft, parseCounts, compareCounts, countTotals,
  classifyError, restoreErrorCount, kstDate, backupTag, assetName, checkPrivateRepo, pruneBackups,
} from '../../scripts/ops/backup-db.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const daily = read('.github/workflows/db-backup-daily.yml');
const restore = read('.github/workflows/db-restore-test.yml');
const script = fileURLToPath(new URL('scripts/ops/backup-db.mjs', root));
const RECIPIENT = `age1${'q'.repeat(58)}`;

// ---- 설정 없음 ----

test('설정이 하나도 없으면 ready=false, 종료 코드 0, 요약에는 이름만 쓴다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-backup-'));
  for (const mode of ['backup-repo-vars', 'backup-env', 'restore-repo-vars', 'restore-env']) {
    const out = join(dir, `${mode}.out`);
    const sum = join(dir, `${mode}.md`);
    writeFileSync(out, '');
    writeFileSync(sum, '');
    const run = spawnSync(process.execPath, [script, 'check-config', mode], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum }, encoding: 'utf8' });
    assert.equal(run.status, 0, mode);
    assert.equal(readFileSync(out, 'utf8'), 'ready=false\n', mode);
    assert.match(readFileSync(sum, 'utf8'), /설정 안 됨/);
    assert.match(run.stdout, /설정 안 됨/);
  }
});

test('빈 값·공백 값도 없는 것으로 본다', () => {
  assert.deepEqual(missingConfig({ A: '', B: '  ', C: 'x' }, ['A', 'B', 'C', 'D']), ['A', 'B', 'D']);
});

test('설정이 다 있으면 ready=true, 값 모양이 틀리면 이름만 알린다', () => {
  assert.equal(checkConfig('backup-repo-vars', { DB_BACKUP_REPO: 'someone/web2-db-backup', DB_BACKUP_AGE_RECIPIENT: RECIPIENT }).ready, true);
  const bad = checkConfig('backup-repo-vars', { DB_BACKUP_REPO: 'someone/web2-db-backup', DB_BACKUP_AGE_RECIPIENT: 'AGE-SECRET-KEY-1XYZ' });
  assert.equal(bad.ready, false);
  assert.deepEqual(bad.invalid, ['DB_BACKUP_AGE_RECIPIENT']);
  assert.doesNotMatch(bad.lines.join('\n'), /AGE-SECRET/);
  // 백업 저장소가 이 공개 저장소와 같으면 거절
  const self = checkConfig('backup-repo-vars', { DB_BACKUP_REPO: 'Owner/Work', DB_BACKUP_AGE_RECIPIENT: RECIPIENT, GITHUB_REPOSITORY: 'owner/work' });
  assert.deepEqual(self.invalid, ['DB_BACKUP_REPO']);
  assert.equal(checkConfig('restore-env', { DB_RESTORE_REPO_TOKEN: 't', DB_BACKUP_AGE_IDENTITY: 'not-a-key' }).ready, false);
  assert.equal(checkConfig('restore-env', { DB_RESTORE_REPO_TOKEN: 't', DB_BACKUP_AGE_IDENTITY: `AGE-SECRET-KEY-1${'Q'.repeat(58)}` }).ready, true);
});

// ---- 보관 개수 ----

const days = (start, count) => Array.from({ length: count }, (_, i) => {
  const d = new Date(Date.UTC(...start) + i * 86400000);
  return `db-${d.toISOString().slice(0, 10).replace(/-/g, '')}`;
});

test('30개 이하면 아무것도 지우지 않는다', () => {
  const tags = days([2026, 10, 1], 30);
  assert.deepEqual(planRetention(tags).remove, []);
  assert.deepEqual(planRetention([]).remove, []);
});

test('최근 30개 + 최근 12개 달의 첫 백업만 남긴다(2년치 매일)', () => {
  const tags = days([2024, 10, 1], 760);
  const { keep, remove } = planRetention(tags);
  const newest = [...tags].sort().reverse();
  for (const tag of newest.slice(0, 30)) assert.ok(keep.includes(tag), tag);
  const monthly = keep.filter(tag => !newest.slice(0, 30).includes(tag));
  assert.ok(monthly.every(tag => tag.endsWith('01')), '달 첫 백업');
  assert.equal(new Set(keep.map(tag => tag.slice(3, 9))).size, 12);
  assert.ok(keep.length <= 30 + 12 && keep.length >= 30 + 10);
  assert.equal(keep.length + remove.length, tags.length);
  assert.ok(keep.includes(newest[0]), '가장 최근 백업은 늘 남는다');
});

test('달 중간부터 시작해도 그달 첫 백업(가장 이른 날)을 남기고, db-YYYYMMDD가 아닌 태그는 건드리지 않는다', () => {
  const tags = [...days([2026, 0, 15], 120), 'v1.0.0', 'db-latest', 'db-2026011'];
  const { keep, remove } = planRetention(tags);
  assert.ok(keep.includes('db-20260115'));
  assert.ok(!remove.some(tag => !/^db-\d{8}$/.test(tag)));
  assert.ok(!keep.includes('v1.0.0'));
});

test('며칠 실패로 띄엄띄엄이어도 날짜가 아니라 개수로 30개를 남긴다', () => {
  const tags = days([2026, 0, 1], 300).filter((_, i) => i % 3 === 0);
  assert.equal(planRetention(tags).keep.filter(tag => tag >= [...tags].sort().reverse()[29]).length, 30);
});

test('보관 정리는 계획한 db- 릴리스만 지우고, 방금 올린 백업이 지울 목록에 있으면 멈춘다', async () => {
  const tags = days([2026, 0, 1], 35);
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`);
    if (url.includes('/releases?')) return new Response(JSON.stringify([...tags.map((tag, i) => ({ id: i + 1, tag_name: tag })), { id: 999, tag_name: 'v9' }]), { status: 200 });
    return new Response(null, { status: 204 });
  };
  const result = await pruneBackups({ fetcher, token: 't', repo: 'o/r', keepTag: tags.at(-1) });
  assert.equal(result.kept, 31); // 30개 + 1월 1일
  assert.equal(result.removed, 4);
  const deletes = calls.filter(call => call.startsWith('DELETE'));
  assert.equal(deletes.length, 8);
  assert.ok(deletes.every(call => /\/repos\/o\/r\/(releases\/\d+|git\/refs\/tags\/db-\d{8})$/.test(call.slice(7))));
  assert.ok(!deletes.some(call => call.includes('/999') || call.includes('v9')));
  await assert.rejects(pruneBackups({ fetcher, token: 't', repo: 'o/r', keepTag: 'db-20250101' }), { code: 'RETENTION_PLAN' });
});

// ---- 비공개 저장소 확인 ----

test('백업 저장소가 공개거나 없으면 올리기 전에 멈춘다', async () => {
  const make = body => async () => new Response(JSON.stringify(body), { status: 200 });
  await assert.rejects(checkPrivateRepo({ fetcher: make({ private: false, visibility: 'public' }), token: 't', repo: 'o/r' }), { code: 'BACKUP_REPO_NOT_PRIVATE' });
  await assert.rejects(checkPrivateRepo({ fetcher: async () => new Response('{}', { status: 404 }), token: 't', repo: 'o/r' }), { code: 'BACKUP_REPO_NOT_FOUND' });
  await assert.rejects(checkPrivateRepo({ fetcher: async () => new Response('{}', { status: 401 }), token: 't', repo: 'o/r' }), { code: 'GITHUB_TOKEN' });
  const ok = await checkPrivateRepo({ fetcher: async () => new Response(JSON.stringify({ private: true, visibility: 'private' }), { status: 200, headers: { 'github-authentication-token-expiration': '2099-01-01 00:00:00 +0900' } }), token: 't', repo: 'o/r' });
  assert.ok(ok.daysLeft > 1000);
});

test('토큰 남은 날 계산', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  assert.equal(tokenDaysLeft('2026-12-02 00:00:00 UTC', now), 30);
  assert.equal(tokenDaysLeft('2026-11-12 09:00:00 +0900', now), 10);
  assert.equal(tokenDaysLeft(null, now), null);
  assert.equal(tokenDaysLeft('nonsense', now), null);
});

// ---- 줄 수 비교 ----

test('줄 수 비교는 개수만 돌려주고 표 이름을 결과에 넣지 않는다', () => {
  const expected = parseCounts('public.a\t3\nauth.users\t2\nmeta:policies\t5\nmeta:functions\t7\n');
  assert.deepEqual(countTotals(expected), { tables: 2, rows: 5 });
  const same = compareCounts(expected, parseCounts('auth.users\t2\npublic.a\t3\nmeta:policies\t5\nmeta:functions\t7\n'));
  assert.equal(same.ok, true);
  const diff = compareCounts(expected, parseCounts('public.a\t2\npublic.z\t1\nmeta:policies\t4\nmeta:functions\t7\n'));
  assert.deepEqual([diff.ok, diff.matched, diff.mismatched, diff.missing, diff.extra, diff.metaOk], [false, 0, 1, 1, 1, false]);
  assert.doesNotMatch(JSON.stringify(diff), /public\.a|auth\.users|public\.z/);
  assert.equal(compareCounts(parseCounts(''), parseCounts('')).ok, false, '빈 덤프는 통과가 아님');
  assert.throws(() => parseCounts('no-tab-line'), /COUNTS_FORMAT/);
});

test('오류 원문은 분류 코드로만 바꾼다', () => {
  assert.equal(classifyError('FATAL: password authentication failed for user "postgres.abc"'), 'AUTH');
  assert.equal(classifyError('pg_dump: error: query failed: ERROR: permission denied for table secret_table'), 'PERMISSION');
  assert.equal(classifyError('pg_dump: error: aborting because of server version mismatch'), 'VERSION');
  assert.equal(classifyError('could not translate host name "x" to address'), 'NETWORK');
  assert.equal(classifyError(''), 'NONE');
  assert.equal(classifyError('something else with row value 010-1234'), 'OTHER');
  assert.equal(restoreErrorCount('pg_restore: warning: errors ignored on restore: 3\n'), 3);
  assert.equal(restoreErrorCount('pg_restore: error: a\npg_restore: error: b\n'), 2);
});

test('날짜·태그·파일 이름은 한국 날짜 기준', () => {
  assert.equal(kstDate(new Date('2026-11-01T19:17:00Z')), '20261102');
  assert.equal(backupTag(new Date('2026-11-01T14:59:00Z')), 'db-20261101');
  assert.equal(assetName('db-20261102'), 'web2-db-20261102.tar.age');
});

test('덤프·줄 수·코드의 스키마 목록이 같다', () => {
  assert.deepEqual(SCHEMAS, ['public', 'private', 'auth', 'storage', 'supabase_migrations']);
  const dump = read('scripts/ops/backup-db-dump.sh');
  assert.deepEqual([...dump.matchAll(/--schema=(\w+)/g)].map(m => m[1]), SCHEMAS);
  const counts = read('scripts/ops/backup-db-counts.sql');
  const lists = [...counts.matchAll(/nspname in \(([^)]+)\)/g)].map(m => m[1].replace(/['\s]/g, '').split(','));
  assert.equal(lists.length, 4);
  for (const list of lists) assert.deepEqual(list, SCHEMAS);
});

// ---- 덤프·줄 수 스크립트 ----

test('덤프는 읽기 전용 거래 하나의 snapshot으로 뜨고, 결과·오류는 파일로만 간다', () => {
  const snap = read('scripts/ops/backup-db-snapshot.sql');
  assert.match(snap, /^begin isolation level repeatable read read only;$/m);
  assert.match(snap, /pg_export_snapshot\(\)/);
  assert.match(snap, /^rollback;$/m);
  assert.doesNotMatch(snap, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate|commit)\b/im);
  const dump = read('scripts/ops/backup-db-dump.sh');
  assert.match(dump, /--snapshot="\$BACKUP_SNAPSHOT"/);
  assert.match(dump, /--format=custom/);
  assert.match(dump, /--file="\$BACKUP_WORK\/db\.pgdump" > \/dev\/null 2> "\$BACKUP_WORK\/pg_dump\.err"/);
  assert.doesNotMatch(dump, /set -x|PGPASSWORD|password=|echo/);
  const counts = read('scripts/ops/backup-db-counts.sql');
  assert.match(counts, /^\\o :out$/m);
  assert.match(counts, /^\\o$/m);
  assert.ok(counts.indexOf('\\o :out') < counts.indexOf('\\gexec'));
  assert.doesNotMatch(counts, /^\s*(insert|update|delete|create|alter|drop|grant|truncate)\b/im);
});

// ---- workflow 정적 검사 ----

for (const [name, source] of [['db-backup-daily.yml', daily], ['db-restore-test.yml', restore]]) {
  test(`${name}: 예약·수동 실행만, main·이 저장소에서만, 권한은 contents: read 하나`, () => {
    const on = source.slice(source.indexOf('\non:\n'), source.indexOf('\npermissions:'));
    assert.match(on, /^  schedule:\n    - cron: '[^']+'\n  workflow_dispatch:\n$/m);
    assert.doesNotMatch(source, /pull_request|^  push:|workflow_run|repository_dispatch/m);
    assert.match(source, /^permissions:\n  contents: read\n\n/m);
    assert.equal([...source.matchAll(/permissions:/g)].length, 1, '작업별 권한 추가 없음');
    assert.doesNotMatch(source, /: write\b/);
    assert.match(source, /^    if: github\.repository == 'mj880616\/work' && github\.ref == 'refs\/heads\/main'$/m);
    assert.match(source, /^    needs: config\n    if: needs\.config\.outputs\.ready == 'true'$/m);
    assert.match(source, /^concurrency:\n  group: db-[a-z-]+\n  cancel-in-progress: false$/m);
    for (const use of source.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
    assert.equal([...source.matchAll(/persist-credentials: false/g)].length, [...source.matchAll(/actions\/checkout@/g)].length);
  });

  test(`${name}: 공개 저장소에 백업·오류 원문을 남기지 않는다`, () => {
    assert.doesNotMatch(source, /upload-artifact|actions\/cache|gh release|git push|git commit/);
    assert.doesNotMatch(source, /set -x|\bcat\b|\bhead\b|\btail\b|pg_restore -l|--verbose|\bxxd\b|\bstrings\b/);
    assert.doesNotMatch(source, /(?:echo|printf)[^\n]*\$\{?(?:PGPASSWORD|SUPABASE_ACCESS_TOKEN|DB_BACKUP_REPO_TOKEN|DB_RESTORE_REPO_TOKEN|DB_BACKUP_AGE_IDENTITY)/);
    assert.doesNotMatch(source, /supabase\s+(db|link|migration)|db push|migration repair/);
    // 비밀값은 env: 줄로만 받고 명령 줄에 바로 넣지 않는다
    for (const line of source.split('\n').filter(line => /secrets\./.test(line))) assert.match(line, /^          [A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/, line);
    // 덤프·되살리기 명령의 stderr는 파일로 간다
    for (const line of source.split('\n').filter(line => /^\s+(psql|pg_restore|age -d) /.test(line) || /\bpsql -X/.test(line))) assert.match(line, /2> "\$work\/[a-z.-]+\.err"/, line);
  });
}

test('매일 백업: production-edge 비밀값은 정해진 셋만, 대상 스키마만, 올리기 전 비공개 확인', () => {
  assert.deepEqual([...new Set([...daily.matchAll(/secrets\.(\w+)/g)].map(m => m[1]))].sort(), ['DB_BACKUP_REPO_TOKEN', 'SUPABASE_ACCESS_TOKEN']);
  assert.deepEqual([...new Set([...daily.matchAll(/vars\.(\w+)/g)].map(m => m[1]))].sort(), ['DB_BACKUP_AGE_RECIPIENT', 'DB_BACKUP_POOLER_HOST', 'DB_BACKUP_REPO', 'SUPABASE_PROJECT_REF']);
  assert.match(daily, /^  backup:\n[\s\S]*?^    environment: production-edge$/m);
  const config = daily.slice(daily.indexOf('\n  config:\n'), daily.indexOf('\n  backup:\n'));
  assert.doesNotMatch(config, /secrets\.|environment:/, '설정 확인 작업은 비밀값·environment 없이');
  assert.match(daily, /cron: '17 19 \* \* \*'/);
  assert.match(daily, /timeout-minutes: 20/);
  assert.match(daily, /PGPASSWORD: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(daily, /\| age -r "\$DB_BACKUP_AGE_RECIPIENT" -o "\$work\/backup\.tar\.age"/);
  assert.ok(daily.indexOf('age -r') < daily.indexOf('backup-db.mjs upload'));
  assert.match(daily, /rm -f "\$work\/db\.pgdump"/);
  assert.match(daily, /if: always\(\)\n        run: rm -rf "\$RUNNER_TEMP\/db-backup"/);
  const helper = read('scripts/ops/backup-db.mjs');
  const upload = helper.slice(helper.indexOf("command === 'upload'"), helper.indexOf("command === 'write-identity'"));
  assert.ok(upload.indexOf('checkPrivateRepo') < upload.indexOf('uploadBackup') && upload.indexOf('uploadBackup') < upload.indexOf('pruneBackups'));
});

test('되살리기 시험: 운영 열쇠 없이 runner 안 빈 DB에만 되살린다', () => {
  assert.deepEqual([...new Set([...restore.matchAll(/secrets\.(\w+)/g)].map(m => m[1]))].sort(), ['DB_BACKUP_AGE_IDENTITY', 'DB_RESTORE_REPO_TOKEN']);
  assert.doesNotMatch(restore, /SUPABASE_|production-edge|supabase\.co|pooler/);
  assert.match(restore, /^    environment: db-restore$/m);
  assert.match(restore, /image: postgres:17\n/);
  assert.match(restore, /PGHOST: localhost/);
  assert.match(restore, /cron: '17 20 1 \* \*'/);
  assert.match(restore, /createdb -T template0 restore_test/);
  assert.match(restore, /pg_restore --no-owner --no-acl -d restore_test/);
  assert.match(restore, /trap 'rm -f "\$work\/identity\.txt"' EXIT/);
  assert.match(restore, /backup-db\.mjs write-identity "\$work\/identity\.txt"/);
  assert.match(restore, /backup-db\.mjs compare /);
  const prep = read('scripts/ops/backup-db-restore-prep.sql');
  assert.match(prep, /nologin/);
  assert.doesNotMatch(prep, /\blogin password|superuser|bypassrls/i);
});

test('도우미는 비밀값을 출력하지 않고 접속 값은 가린 뒤에만 환경에 넣는다', () => {
  const helper = read('scripts/ops/backup-db.mjs');
  for (const line of helper.split('\n').filter(line => line.includes('console.log('))) assert.doesNotMatch(line, /env\.(?:\w*TOKEN|\w*IDENTITY|PGPASSWORD)|\btoken\b(?!\()/, line);
  assert.doesNotMatch(helper, /setEnv\('PGPASSWORD'/);
  const resolve = helper.slice(helper.indexOf("command === 'resolve-host'"), helper.indexOf("command === 'classify'"));
  assert.ok(resolve.indexOf('mask(host)') < resolve.indexOf("setEnv('PGHOST'"));
  assert.match(resolve, /setEnv\('PGOPTIONS', '-c jit=true'\)/);
  assert.match(resolve, /setEnv\('PGSSLMODE', 'require'\)/);
});
