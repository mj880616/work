#!/usr/bin/env node
// SEC-공개저장소청소 ②: 공개 저장소에 실제 사람 이름·실제 단체 이름 같은 '공개 금지 낱말'이 새로 들어오지 않게 막는다.
//
// - 낱말 목록은 저장소에 두지 않는다. GitHub Actions 저장소 비밀값 PUBLIC_WORDS_LIST(줄마다 낱말 하나)에만 둔다.
//   짧은 한글 낱말은 해시로 적어도 몇 분이면 거꾸로 풀리므로, 해시 목록 대신 비밀값에 둔다.
// - 검사 대상은 '새로 더해진 줄'뿐이다(--base/--head 사이 git diff). 예전 파일·지난 기록 때문에 CI가 깨지지 않는다.
//   이미 운영에 적용된 supabase/migrations 파일처럼 그대로 둬야 하는 곳은 scripts/public-words-allow.json에 이유와 함께 적는다.
// - PR 제목·본문은 --event(GITHUB_EVENT_PATH)로 같은 목록을 본다.
// - 결과에는 위치(파일·줄)와 목록 안 번호만 찍는다. 낱말 원문·줄 내용은 찍지 않는다(CI 기록도 공개).
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOW_PATH = 'scripts/public-words-allow.json';

export function parseList(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'));
}

// 낱말이 든 위치 목록: [{word: 목록 번호(1부터), line}]. 한 줄에 같은 낱말은 한 번만 센다.
export function findWords(text, words) {
  const out = [];
  const lines = String(text || '').split('\n');
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    words.forEach((w, k) => {
      if (low.includes(w.toLowerCase())) out.push({word: k + 1, line: i + 1});
    });
  });
  return out;
}

export function loadAllow(base = root) {
  const data = JSON.parse(readFileSync(join(base, ALLOW_PATH), 'utf8'));
  if (!Array.isArray(data.entries)) throw new Error(`${ALLOW_PATH}: entries 배열이 없음`);
  for (const [i, e] of data.entries.entries()) {
    if (!Array.isArray(e.paths) || !e.paths.length) throw new Error(`${ALLOW_PATH}#${i}: paths 필요`);
    if (typeof e.reason !== 'string' || !e.reason.trim()) throw new Error(`${ALLOW_PATH}#${i}: reason 필요`);
  }
  return data.entries;
}

export function isAllowedPath(path, allow) {
  return allow.some(e => e.paths.some(p => (p.endsWith('/') ? path.startsWith(p) : path === p)));
}

// git diff -U0 출력에서 새로 더해진 줄만 [{path, line, text}]로 뽑는다.
export function addedLines(diff) {
  const out = [];
  let path = null;
  let ln = 0;
  for (const raw of String(diff).split('\n')) {
    if (raw.startsWith('+++ ')) {
      path = raw === '+++ /dev/null' ? null : raw.replace(/^\+\+\+ b\//, '');
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      ln = Number(h[1]);
      continue;
    }
    if (!path) continue;
    if (raw.startsWith('+')) {
      out.push({path, line: ln, text: raw.slice(1)});
      ln += 1;
    } else if (raw.startsWith(' ')) {
      ln += 1;
    }
  }
  return out;
}

export function scanDiff(diff, words, allow) {
  const problems = [];
  for (const a of addedLines(diff)) {
    if (isAllowedPath(a.path, allow)) continue;
    for (const f of findWords(a.text, words)) problems.push({path: a.path, line: a.line, word: f.word, file: true});
  }
  return problems;
}

export function scanEvent(event, words) {
  const pr = event && event.pull_request;
  if (!pr) return [];
  const problems = [];
  for (const f of findWords(pr.title || '', words)) problems.push({path: 'PR 제목', line: f.line, word: f.word});
  for (const f of findWords(pr.body || '', words)) problems.push({path: 'PR 본문', line: f.line, word: f.word});
  return problems;
}

// 개인 메일 모양(check-personal-data.mjs와 같은 목록). 커밋 작성자·커미터 메일은 GitHub noreply 주소만 쓴다.
const PERSONAL_MAIL = /@(?:gmail|naver|daum|hanmail|kakao|nate|hotmail|outlook|yahoo|icloud|me)\.(?:com|net|co\.kr)$/i;

// git log 출력(커밋마다 sha\0작성자메일\0커미터메일\0메시지\x1e)을 본다.
export function scanCommits(log, words) {
  const problems = [];
  for (const rec of String(log).split('\x1e')) {
    const [sha, author, committer, ...rest] = rec.replace(/^\n+/, '').split('\0');
    if (!sha) continue;
    const short = sha.slice(0, 9);
    if (PERSONAL_MAIL.test(author || '')) problems.push({path: `커밋 ${short}`, line: 0, kind: '작성자 메일'});
    if (PERSONAL_MAIL.test(committer || '')) problems.push({path: `커밋 ${short}`, line: 0, kind: '커미터 메일'});
    for (const f of findWords(rest.join('\0'), words)) problems.push({path: `커밋 ${short} 메시지`, line: f.line, word: f.word});
  }
  return problems;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const words = parseList(process.env.PUBLIC_WORDS_LIST);
  if (!words.length) {
    // 비밀값이 아직 없으면 낱말 검사는 건너뛰고 커밋 작성자 메일 검사만 한다(비밀값은 저장소 주인이 Actions 설정에서 넣는다).
    const msg = '공개 금지 낱말 목록(비밀값 PUBLIC_WORDS_LIST)이 없음. 낱말 검사는 건너뛰고 커밋 작성자 메일만 본다';
    if (process.argv.includes('--require-list')) {
      console.error(`::error::${msg}`);
      process.exit(1);
    }
    console.log(`::warning::${msg}`);
  }
  let problems = [];
  const base = arg('--base');
  const head = arg('--head');
  if (base && head) {
    const diff = execFileSync(
      'git',
      ['-C', root, 'diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=AMR', '--text', base, head],
      {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024},
    );
    problems = problems.concat(scanDiff(diff, words, loadAllow()));
    const log = execFileSync('git', ['-C', root, 'log', '--no-merges', '--format=%H%x00%ae%x00%ce%x00%B%x1e', `${base}..${head}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    problems = problems.concat(scanCommits(log, words));
  }
  if (process.argv.includes('--event') && process.env.GITHUB_EVENT_PATH) {
    problems = problems.concat(scanEvent(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), words));
  }
  if (problems.length) {
    for (const p of problems) {
      if (p.kind) console.log(`::error::${p.path}: ${p.kind}이 개인 메일 모양. git config user.email을 GitHub noreply 주소로 둔다`);
      else if (p.file) console.log(`::error file=${p.path},line=${p.line}::공개 금지 낱말 #${p.word}`);
      else console.log(`::error::${p.path} ${p.line}째 줄: 공개 금지 낱말 #${p.word}`);
    }
    console.error(
      `\n공개 금지 낱말 ${problems.length}곳. 실제 사람 이름은 '사용자'·'운영자'로, 실제 단체 이름은 가짜 이름(예: A노조)으로 바꾼다. ` +
        `낱말 번호가 무엇인지는 저장소 비밀값 주인만 안다.`,
    );
    process.exit(1);
  }
  console.log('공개 금지 낱말 검사 통과');
}
