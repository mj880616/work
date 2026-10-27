#!/usr/bin/env node
// SEC-공개저장소점검: 공개 저장소에 개인정보 모양 글자(휴대전화·유선전화·주민번호·개인 메일·키/토큰)가
// 새로 들어오지 않게 막는다. git이 추적하는 모든 텍스트 파일을 읽는다.
//
// - 시험용 가짜 값(010-1234-5678, 010-0000-0000, 900101-1234567처럼 숫자 묶음이 같은 숫자 반복이거나
//   연속 숫자인 값)은 자동으로 넘긴다.
// - 원래 공개하는 값(보도자료 담당 연락처 등)과 결정 대기 경로는 scripts/personal-data-allowlist.json에
//   이유와 함께 적는다. 값은 원문 대신 sha256 앞 16자리로 적는다.
// - 공개 저장소의 CI 기록에도 원문을 남기지 않도록 결과에는 경로·줄·종류·해시만 출력한다.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST_PATH = 'scripts/personal-data-allowlist.json';

const PERSONAL_MAIL = '(?:gmail|naver|daum|hanmail|kakao|nate|hotmail|outlook|yahoo|icloud|me)';

export const RULES = [
  {kind: 'mobile', re: /(?<![\d.])01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/g},
  {kind: 'landline', re: /(?<![\d.])0(?:2|[3-6][1-5]|70)[-. )]\d{3,4}[-. ]\d{4}(?!\d)/g},
  {kind: 'rrn', re: /(?<![\d-])\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-[1-4]\d{6}(?![\d-])/g},
  {kind: 'email', re: new RegExp(`[A-Za-z0-9._%+-]+@${PERSONAL_MAIL}\\.(?:com|net|co\\.kr)\\b`, 'gi')},
  {
    kind: 'secret',
    re: /\b(?:ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|sb_secret_[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
];

// 숫자 묶음이 같은 숫자 반복(0000, 1111)이거나 1씩 오르내리는 연속 숫자(1234, 9876)면 가짜로 본다.
export function isDummyGroup(group) {
  if (!/^\d+$/.test(group)) return false;
  if (/^(\d)\1*$/.test(group)) return true;
  const d = [...group].map(Number);
  const asc = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const desc = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  return asc || desc;
}

function phoneGroups(kind, digits) {
  const prefix = kind === 'mobile' ? 3 : digits.startsWith('02') ? 2 : 3;
  const rest = digits.slice(prefix);
  return [rest.slice(0, rest.length - 4), rest.slice(-4)];
}

export function isDummyValue(kind, value) {
  const digits = value.replace(/\D/g, '');
  if (kind === 'mobile' || kind === 'landline') return phoneGroups(kind, digits).every(isDummyGroup);
  if (kind === 'rrn') {
    const back = digits.slice(6);
    return isDummyGroup(back) || isDummyGroup(back.slice(1));
  }
  return false;
}

export function normalize(kind, value) {
  if (kind === 'mobile' || kind === 'landline' || kind === 'rrn') return value.replace(/\D/g, '');
  if (kind === 'email') return value.toLowerCase();
  return value;
}

export function valueHash(kind, value) {
  return createHash('sha256').update(`${kind}:${normalize(kind, value)}`).digest('hex').slice(0, 16);
}

export function scanText(text) {
  const found = [];
  for (const {kind, re} of RULES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (isDummyValue(kind, m[0])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      found.push({kind, line, hash: valueHash(kind, m[0])});
    }
  }
  return found;
}

function pathMatches(path, prefixes) {
  return prefixes.some(p => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

// 허용 항목: {kinds, paths, hashes?, reason}. hashes가 없으면 그 경로의 해당 종류 전부를 허용한다
// (외부 라이브러리·결정 대기 경로에만 쓴다). hashes가 있으면 그 값만 허용한다.
export function isAllowed(path, finding, allowlist, used = new Set()) {
  for (const [i, entry] of allowlist.entries()) {
    if (!entry.kinds.includes(finding.kind)) continue;
    if (!pathMatches(path, entry.paths)) continue;
    if (entry.hashes && !entry.hashes.includes(finding.hash)) continue;
    used.add(i);
    return true;
  }
  return false;
}

export function loadAllowlist(base = root) {
  const data = JSON.parse(readFileSync(join(base, ALLOWLIST_PATH), 'utf8'));
  const entries = data.entries;
  if (!Array.isArray(entries)) throw new Error(`${ALLOWLIST_PATH}: entries 배열이 없음`);
  for (const [i, e] of entries.entries()) {
    if (!Array.isArray(e.kinds) || !e.kinds.length) throw new Error(`${ALLOWLIST_PATH}#${i}: kinds 필요`);
    if (!Array.isArray(e.paths) || !e.paths.length) throw new Error(`${ALLOWLIST_PATH}#${i}: paths 필요`);
    if (typeof e.reason !== 'string' || !e.reason.trim()) throw new Error(`${ALLOWLIST_PATH}#${i}: reason 필요`);
    if (e.kinds.includes('secret') && !e.hashes) throw new Error(`${ALLOWLIST_PATH}#${i}: secret은 경로 전체 허용 불가`);
    if (e.kinds.includes('rrn') && !e.hashes) throw new Error(`${ALLOWLIST_PATH}#${i}: rrn은 경로 전체 허용 불가`);
  }
  return entries;
}

export function trackedFiles(base = root) {
  return execFileSync('git', ['-C', base, 'ls-files', '-z'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
    .split('\0')
    .filter(Boolean);
}

export function scanRepo(base = root) {
  const allowlist = loadAllowlist(base);
  const used = new Set();
  const problems = [];
  for (const path of trackedFiles(base)) {
    if (path === ALLOWLIST_PATH) continue;
    let buf;
    try {
      buf = readFileSync(join(base, path));
    } catch {
      continue; // 지워졌거나 하위 모듈
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // 이진 파일
    for (const f of scanText(buf.toString('utf8'))) {
      if (!isAllowed(path, f, allowlist, used)) problems.push({path, ...f});
    }
  }
  const unused = allowlist.map((e, i) => ({i, e})).filter(({i}) => !used.has(i));
  return {problems, unused};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {problems, unused} = scanRepo();
  for (const {i, e} of unused) {
    console.log(`::warning::${ALLOWLIST_PATH} 항목 ${i}(${e.paths.join(', ')})은 더 이상 쓰이지 않음. 지워도 됨`);
  }
  if (problems.length) {
    for (const p of problems) {
      console.log(`::error file=${p.path},line=${p.line}::개인정보 모양(${p.kind}) hash=${p.hash}`);
    }
    console.error(
      `\n개인정보 모양 ${problems.length}건. 실제 개인정보면 지운다. 원래 공개하는 값이면 ` +
        `${ALLOWLIST_PATH}에 kinds·paths·hashes·reason을 적는다(값 원문은 적지 않는다).`,
    );
    process.exit(1);
  }
  console.log('개인정보 모양 검사 통과');
}
