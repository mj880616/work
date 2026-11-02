// OPS-DB백업: 매일 백업(.github/workflows/db-backup-daily.yml)과 월 1회 되살리기 시험(.github/workflows/db-restore-test.yml)이 부르는 도우미.
// 설계: docs/design/db-backup.md, 명진 설정 순서: docs/ops-db-backup-setup.md.
//
// 공개 저장소의 Actions 로그는 공개로 본다. 그래서 이 스크립트는
// - 비밀값·접속 주소·표 이름·행 값을 출력하지 않는다(설정 이름·개수·날짜·크기·해시 앞 16자·고정 문구만).
// - 비밀값은 환경 변수로만 받고 명령 인자로 넘기지 않는다.
// - 오류 원문(pg_dump·psql·pg_restore stderr)은 runner 임시 폴더 파일에만 두고, 로그에는 분류 코드만 쓴다.
// - 백업 파일은 비공개 저장소(Release)로만 보낸다. 대상 저장소가 공개이거나 이 저장소와 같으면 올리지 않는다.
import { appendFileSync, createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SCHEMAS = ['public', 'private', 'auth', 'storage', 'supabase_migrations'];
export const KEEP_DAILY = 30;
export const KEEP_MONTHLY = 12;
export const TOKEN_WARN_DAYS = 30;
const TAG = /^db-(\d{4})(\d{2})(\d{2})$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
const PROJECT_REF = /^[a-z]{20}$/;

// 모드별로 꼭 있어야 하는 설정 이름. 값은 보지 않고 있는지만 본다.
export const REQUIRED = {
  'backup-repo-vars': ['DB_BACKUP_REPO', 'DB_BACKUP_AGE_RECIPIENT'],
  'backup-env': ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'DB_BACKUP_REPO_TOKEN'],
  'restore-repo-vars': ['DB_BACKUP_REPO'],
  'restore-env': ['DB_RESTORE_REPO_TOKEN', 'DB_BACKUP_AGE_IDENTITY'],
};

export function missingConfig(env, names) {
  return names.filter(name => typeof env[name] !== 'string' || !env[name].trim());
}

// 값 모양 검사. 틀린 값은 이름만 알린다.
export function invalidConfig(env, { selfRepo } = {}) {
  const bad = [];
  if (env.DB_BACKUP_REPO !== undefined && env.DB_BACKUP_REPO !== '') {
    const repo = env.DB_BACKUP_REPO.trim();
    if (!REPO.test(repo) || (selfRepo && repo.toLowerCase() === selfRepo.toLowerCase())) bad.push('DB_BACKUP_REPO');
  }
  if (env.DB_BACKUP_AGE_RECIPIENT && !AGE_RECIPIENT.test(env.DB_BACKUP_AGE_RECIPIENT.trim())) bad.push('DB_BACKUP_AGE_RECIPIENT');
  if (env.SUPABASE_PROJECT_REF && !PROJECT_REF.test(env.SUPABASE_PROJECT_REF.trim())) bad.push('SUPABASE_PROJECT_REF');
  if (env.DB_BACKUP_AGE_IDENTITY && !/^AGE-SECRET-KEY-1[0-9A-Z]{58}$/.test(env.DB_BACKUP_AGE_IDENTITY.trim())) bad.push('DB_BACKUP_AGE_IDENTITY');
  return bad;
}

// 한국 날짜(YYYYMMDD). 백업 태그는 db-YYYYMMDD.
export function kstDate(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}
export const backupTag = (now = new Date()) => `db-${kstDate(now)}`;
export const assetName = tag => `web2-db-${tag.slice(3)}.tar.age`;

// 보관 정리: 최근 백업 30개 + 최근 12개 달의 그달 첫 백업 1개씩. 나머지 db-YYYYMMDD만 지운다.
// 날짜가 아니라 개수로 세므로 며칠 실패해도 남은 백업이 줄지 않는다. 가장 최근 백업은 늘 남는다.
export function planRetention(tags, { daily = KEEP_DAILY, monthly = KEEP_MONTHLY } = {}) {
  const dated = [...new Set(tags.filter(tag => TAG.test(tag)))].sort().reverse();
  const keep = new Set(dated.slice(0, daily));
  const firstOfMonth = new Map();
  for (const tag of [...dated].reverse()) {
    const month = tag.slice(3, 9);
    if (!firstOfMonth.has(month)) firstOfMonth.set(month, tag);
  }
  const months = [...firstOfMonth.keys()].sort().reverse().slice(0, monthly);
  for (const month of months) keep.add(firstOfMonth.get(month));
  const remove = dated.filter(tag => !keep.has(tag));
  return { keep: dated.filter(tag => keep.has(tag)), remove };
}

// GitHub fine-grained 토큰 응답 머리글 github-authentication-token-expiration("2027-11-01 12:00:00 +0900" 꼴)로 남은 날.
export function tokenDaysLeft(header, now = new Date()) {
  if (!header) return null;
  const match = String(header).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(?:([+-])(\d{2}):?(\d{2})|UTC|Z)?$/);
  if (!match) return null;
  const offset = match[3] ? `${match[3]}${match[4]}:${match[5]}` : 'Z';
  const at = Date.parse(`${match[1]}T${match[2]}${offset}`);
  if (!Number.isFinite(at)) return null;
  return Math.floor((at - now.getTime()) / 86400000);
}

// 줄 수 파일: "이름\t숫자" 한 줄씩. meta:로 시작하는 줄은 RLS 표·정책·함수 개수.
export function parseCounts(text) {
  const tables = new Map();
  const meta = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.lastIndexOf('\t');
    if (at < 1) throw new Error('COUNTS_FORMAT');
    const name = line.slice(0, at);
    const value = Number(line.slice(at + 1));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('COUNTS_FORMAT');
    (name.startsWith('meta:') ? meta : tables).set(name, value);
  }
  return { tables, meta };
}

export function countTotals(parsed) {
  let rows = 0;
  for (const value of parsed.tables.values()) rows += value;
  return { tables: parsed.tables.size, rows };
}

// 되살린 DB와 덤프 때 센 값 비교. 표 이름은 결과에 넣지 않는다(개수만).
export function compareCounts(expected, actual) {
  let matched = 0;
  let mismatched = 0;
  let missing = 0;
  for (const [name, value] of expected.tables) {
    if (!actual.tables.has(name)) missing += 1;
    else if (actual.tables.get(name) === value) matched += 1;
    else mismatched += 1;
  }
  let extra = 0;
  for (const name of actual.tables.keys()) if (!expected.tables.has(name)) extra += 1;
  const meta = {};
  for (const [name, value] of expected.meta) meta[name.slice(5)] = { expected: value, actual: actual.meta.get(name) ?? null };
  const metaOk = Object.values(meta).every(item => item.expected === item.actual) && expected.meta.size > 0;
  const ok = expected.tables.size > 0 && matched === expected.tables.size && extra === 0 && metaOk;
  return { total: expected.tables.size, matched, mismatched, missing, extra, meta, metaOk, ok };
}

// 오류 원문을 로그에 내지 않고 분류 코드만 고른다.
export function classifyError(text) {
  const s = String(text || '');
  if (/password authentication failed|authentication failed|invalid (?:token|password)/i.test(s)) return 'AUTH';
  if (/permission denied|must be (?:owner|superuser)/i.test(s)) return 'PERMISSION';
  if (/server version|version mismatch|aborting because of server version/i.test(s)) return 'VERSION';
  if (/could not translate host|timeout|timed out|connection refused|could not connect|network|SSL/i.test(s)) return 'NETWORK';
  if (/out of memory|no space left/i.test(s)) return 'RESOURCE';
  if (!s.trim()) return 'NONE';
  return 'OTHER';
}

export function restoreErrorCount(text) {
  const match = String(text || '').match(/errors ignored on restore:\s*(\d+)/);
  if (match) return Number(match[1]);
  return (String(text || '').match(/^pg_restore: error:/gm) ?? []).length;
}

// ---- GitHub·Supabase API ----

const GH = 'https://api.github.com';
const ghHeaders = token => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'web2-db-backup' });

export class BackupFailure extends Error {
  constructor(code) { super(code); this.name = 'BackupFailure'; this.code = code; }
}

async function gh(fetcher, token, method, path, body, { allow404 = false } = {}) {
  let response;
  try {
    response = await fetcher(path.startsWith('https://') ? path : `${GH}${path}`, {
      method, headers: { ...ghHeaders(token), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new BackupFailure('GITHUB_NETWORK'); }
  if (allow404 && response.status === 404) return { response, data: null };
  if (response.status === 401 || response.status === 403) throw new BackupFailure('GITHUB_TOKEN');
  if (!response.ok) throw new BackupFailure(`GITHUB_HTTP_${response.status}`);
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, data };
}

// 대상이 비공개 저장소인지 먼저 본다. 공개면 아무것도 올리지 않는다.
export async function checkPrivateRepo({ fetcher = fetch, token, repo }) {
  const { response, data } = await gh(fetcher, token, 'GET', `/repos/${repo}`, null, { allow404: true });
  if (!data) throw new BackupFailure('BACKUP_REPO_NOT_FOUND');
  if (data.private !== true || data.visibility === 'public') throw new BackupFailure('BACKUP_REPO_NOT_PRIVATE');
  return { daysLeft: tokenDaysLeft(response.headers.get('github-authentication-token-expiration')) };
}

async function listBackupReleases({ fetcher, token, repo }) {
  const all = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await gh(fetcher, token, 'GET', `/repos/${repo}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data.filter(release => TAG.test(release?.tag_name ?? '')));
    if (data.length < 100) break;
  }
  return all;
}

export async function uploadBackup({ fetcher = fetch, token, repo, file, tag }) {
  const name = assetName(tag);
  let { data: release } = await gh(fetcher, token, 'GET', `/repos/${repo}/releases/tags/${tag}`, null, { allow404: true });
  if (!release) {
    ({ data: release } = await gh(fetcher, token, 'POST', `/repos/${repo}/releases`, { tag_name: tag, name: tag, body: 'Encrypted DB backup (age).', draft: false, prerelease: false, make_latest: 'false' }));
  }
  for (const asset of release?.assets ?? []) {
    if (asset?.name === name) await gh(fetcher, token, 'DELETE', `/repos/${repo}/releases/assets/${asset.id}`);
  }
  const size = statSync(file).size;
  let response;
  try {
    response = await fetcher(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { ...ghHeaders(token), 'content-type': 'application/octet-stream', 'content-length': String(size) }, body: createReadStream(file), duplex: 'half',
    });
  } catch { throw new BackupFailure('GITHUB_UPLOAD_NETWORK'); }
  if (!response.ok) throw new BackupFailure(`GITHUB_UPLOAD_HTTP_${response.status}`);
  const asset = await response.json().catch(() => null);
  if (asset?.size !== size) throw new BackupFailure('GITHUB_UPLOAD_SIZE');
  return { size };
}

export async function pruneBackups({ fetcher = fetch, token, repo, keepTag }) {
  const releases = await listBackupReleases({ fetcher, token, repo });
  const plan = planRetention(releases.map(release => release.tag_name));
  if (keepTag && !plan.keep.includes(keepTag)) throw new BackupFailure('RETENTION_PLAN');
  let removed = 0;
  for (const tag of plan.remove) {
    const release = releases.find(item => item.tag_name === tag);
    await gh(fetcher, token, 'DELETE', `/repos/${repo}/releases/${release.id}`);
    await gh(fetcher, token, 'DELETE', `/repos/${repo}/git/refs/tags/${tag}`, null, { allow404: true });
    removed += 1;
  }
  return { kept: plan.keep.length, removed };
}

export async function downloadLatest({ fetcher = fetch, token, repo, out }) {
  const releases = await listBackupReleases({ fetcher, token, repo });
  const latest = releases.sort((a, b) => b.tag_name.localeCompare(a.tag_name))[0];
  if (!latest) throw new BackupFailure('NO_BACKUP');
  const asset = (latest.assets ?? []).find(item => item?.name === assetName(latest.tag_name));
  if (!asset) throw new BackupFailure('NO_BACKUP_FILE');
  let response;
  try {
    response = await fetcher(`${GH}/repos/${repo}/releases/assets/${asset.id}`, { headers: { ...ghHeaders(token), accept: 'application/octet-stream' } });
  } catch { throw new BackupFailure('GITHUB_NETWORK'); }
  if (!response.ok) throw new BackupFailure(`GITHUB_DOWNLOAD_HTTP_${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(out, buffer, { mode: 0o600 });
  return { tag: latest.tag_name, size: buffer.length };
}

// 토큰 임시 접속(JIT)이 켜져 있는지, 공용 pooler 주소가 무엇인지 관리 API로 본다.
export async function resolvePooler({ fetcher = fetch, token, ref, override }) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const call = async path => {
    let response;
    try { response = await fetcher(`https://api.supabase.com/v1/projects/${ref}${path}`, { headers }); } catch { throw new BackupFailure('SUPABASE_NETWORK'); }
    if (response.status === 401 || response.status === 403) throw new BackupFailure('SUPABASE_TOKEN');
    return response;
  };
  const jit = await call('/jit-access');
  let jitState = 'unknown';
  if (jit.ok) {
    const data = await jit.json().catch(() => null);
    const state = String(data?.state ?? data?.status ?? '').toLowerCase();
    if (state) jitState = state === 'enabled' ? 'enabled' : 'disabled';
  }
  if (jitState === 'disabled') return { jitState, host: null };
  let host = override && /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(override.trim()) ? override.trim() : null;
  if (!host) {
    const pooler = await call('/config/database/pooler');
    if (!pooler.ok) throw new BackupFailure(`SUPABASE_POOLER_HTTP_${pooler.status}`);
    const data = await pooler.json().catch(() => null);
    const list = Array.isArray(data) ? data : [data];
    const primary = list.find(item => item?.database_type === 'PRIMARY') ?? list[0];
    host = typeof primary?.db_host === 'string' && /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(primary.db_host) ? primary.db_host : null;
    if (!host) throw new BackupFailure('SUPABASE_POOLER_HOST');
  }
  return { jitState, host };
}

export const sha256Prefix = file => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
export const toMb = bytes => Math.max(1, Math.round(bytes / 1048576));

// ---- 명령 ----

const summary = lines => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`); };
const output = (key, value) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`); };
const setEnv = (key, value) => { if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`); };
const mask = value => { if (value) console.log(`::add-mask::${value}`); };

export function checkConfig(mode, env = process.env) {
  const names = REQUIRED[mode];
  if (!names) throw new Error('UNKNOWN_MODE');
  const missing = missingConfig(env, names);
  const invalid = missing.length ? [] : invalidConfig(env, { selfRepo: env.GITHUB_REPOSITORY });
  const ready = missing.length === 0 && invalid.length === 0;
  const lines = ready ? [] : [
    '## DB 백업: 설정 안 됨',
    '',
    missing.length ? `없는 설정 이름: ${missing.map(name => `\`${name}\``).join(', ')}` : `모양이 틀린 설정 이름: ${invalid.map(name => `\`${name}\``).join(', ')}`,
    '',
    '아무것도 하지 않고 끝냈습니다. 등록 위치는 `docs/ops-db-backup-setup.md`를 보세요.',
  ];
  return { ready, missing, invalid, lines };
}

async function main(argv) {
  const [command, ...args] = argv;
  const env = process.env;
  try {
    if (command === 'check-config') {
      const result = checkConfig(args[0], env);
      output('ready', String(result.ready));
      if (!result.ready) { summary(result.lines); console.log('설정 안 됨: 아무것도 하지 않고 끝냅니다.'); }
      return 0;
    }
    if (command === 'resolve-host') {
      const ref = env.SUPABASE_PROJECT_REF.trim();
      mask(ref);
      const { jitState, host } = await resolvePooler({ token: env.SUPABASE_ACCESS_TOKEN, ref, override: env.DB_BACKUP_POOLER_HOST });
      if (jitState === 'disabled') {
        output('ready', 'false');
        summary(['## DB 백업: 설정 안 됨', '', 'Supabase "임시 접속(temporary access)"이 꺼져 있어 아무것도 하지 않고 끝냈습니다. `docs/ops-db-backup-setup.md` 1단계를 보세요.']);
        console.log('설정 안 됨: 임시 접속 꺼짐.');
        return 0;
      }
      mask(host);
      mask(`postgres.${ref}`);
      setEnv('PGHOST', host);
      setEnv('PGPORT', '5432');
      setEnv('PGUSER', `postgres.${ref}`);
      setEnv('PGDATABASE', 'postgres');
      setEnv('PGSSLMODE', 'require');
      setEnv('PGOPTIONS', '-c jit=true');
      setEnv('PGCONNECT_TIMEOUT', '20');
      output('ready', 'true');
      console.log(`접속 준비 완료(임시 접속 상태: ${jitState}).`);
      return 0;
    }
    if (command === 'classify') {
      let text = '';
      for (const file of args) { try { text += readFileSync(file, 'utf8'); } catch { /* 없으면 빈 값 */ } }
      console.log(classifyError(text));
      return 0;
    }
    if (command === 'dump-summary') {
      const [countsFile, encrypted] = args;
      const totals = countTotals(parseCounts(readFileSync(countsFile, 'utf8')));
      if (totals.tables === 0) throw new BackupFailure('COUNTS_EMPTY');
      const size = statSync(encrypted).size;
      output('tables', String(totals.tables));
      output('rows', String(totals.rows));
      output('size_mb', String(toMb(size)));
      output('sha16', sha256Prefix(encrypted));
      return 0;
    }
    if (command === 'upload') {
      const [file] = args;
      const repo = env.DB_BACKUP_REPO.trim();
      const token = env.DB_BACKUP_REPO_TOKEN;
      const tag = backupTag();
      const { daysLeft } = await checkPrivateRepo({ token, repo });
      await uploadBackup({ token, repo, file, tag });
      const { kept, removed } = await pruneBackups({ token, repo, keepTag: tag });
      const lines = [
        '## DB 백업: 성공',
        '',
        '| 항목 | 값 |',
        '| --- | --- |',
        `| 날짜(KST) | ${tag.slice(3)} |`,
        `| 잠근 파일 크기 | 약 ${env.BACKUP_SIZE_MB} MB |`,
        `| 잠근 파일 SHA-256 앞 16자 | \`${env.BACKUP_SHA16}\` |`,
        `| 표 개수 | ${env.BACKUP_TABLES} |`,
        `| 전체 줄 수 합계 | ${env.BACKUP_ROWS} |`,
        `| 보관 중 | ${kept}개 (이번에 지움 ${removed}개) |`,
        `| 백업 저장소 토큰 남은 날 | ${daysLeft === null ? '만료일 없음 또는 확인 불가' : `${daysLeft}일`} |`,
      ];
      summary(lines);
      if (daysLeft !== null && daysLeft <= TOKEN_WARN_DAYS) console.log(`::warning::백업 저장소 토큰(DB_BACKUP_REPO_TOKEN)이 ${daysLeft}일 뒤 만료됩니다. 새 토큰으로 바꿔 주세요.`);
      console.log('백업 올리기·보관 정리 완료.');
      return 0;
    }
    if (command === 'write-identity') {
      writeFileSync(args[0], `${env.DB_BACKUP_AGE_IDENTITY.trim()}\n`, { mode: 0o600 });
      return 0;
    }
    if (command === 'fetch-latest') {
      const repo = env.DB_BACKUP_REPO.trim();
      const token = env.DB_RESTORE_REPO_TOKEN;
      await checkPrivateRepo({ token, repo });
      const { tag, size } = await downloadLatest({ token, repo, out: args[0] });
      output('tag', tag);
      output('size_mb', String(toMb(size)));
      console.log(`가장 최근 백업 ${tag.slice(3)} 받음(약 ${toMb(size)} MB).`);
      return 0;
    }
    if (command === 'compare') {
      const [expectedFile, actualFile, restoreErrFile] = args;
      const result = compareCounts(parseCounts(readFileSync(expectedFile, 'utf8')), parseCounts(readFileSync(actualFile, 'utf8')));
      let restoreErrors = 0;
      try { restoreErrors = restoreErrorCount(readFileSync(restoreErrFile, 'utf8')); } catch { /* 없음 */ }
      const metaLine = Object.entries(result.meta).map(([name, item]) => `${name} ${item.expected === item.actual ? '일치' : '불일치'}`).join(' · ');
      summary([
        `## DB 되살리기 시험: ${result.ok ? '통과' : '실패'}`,
        '',
        '| 항목 | 값 |',
        '| --- | --- |',
        `| 백업 날짜(KST) | ${(env.RESTORE_TAG || '').slice(3)} |`,
        `| 표 | ${result.total}개 중 ${result.matched}개 줄 수 일치 |`,
        `| 줄 수 다름 / 없음 / 덤프에 없던 표 | ${result.mismatched} / ${result.missing} / ${result.extra} |`,
        `| RLS 표·정책·함수 개수 | ${metaLine || '없음'} |`,
        `| 되살리기 중 무시된 오류 | ${restoreErrors}개 |`,
        `| 걸린 시간 | ${env.RESTORE_SECONDS || '?'}초 |`,
      ]);
      console.log(result.ok ? '되살리기 시험 통과.' : '되살리기 시험 실패: 개수가 맞지 않습니다(표 이름은 출력하지 않음).');
      return result.ok ? 0 : 1;
    }
    console.log('알 수 없는 명령');
    return 2;
  } catch (error) {
    const code = error instanceof BackupFailure ? error.code : (error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UNEXPECTED');
    console.log(`::error::DB 백업 도우미 실패: ${code}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
