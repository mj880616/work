#!/usr/bin/env node
// tests/ 아래 단위 시험(*.test.mjs|js|cjs)이 GitHub workflow에 등록됐는지 확인한다 (STAB-단위시험등록).
// 등록 = workflow의 `node --test ...` 목록·glob, 또는 tests/auth-handoff/package.json의 test 목록
// (authz-security-check.yml이 `npm test`로 실행). tests/app-e2e의 *.spec.mjs는 Playwright가 폴더째
// 실행하므로 이 검사 대상이 아니다. 어느 workflow에도 없는 파일은 아래 EXCEPTIONS에 이유와 함께 적어야 한다.
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 예외: workflow에 등록하지 않는 단위 시험. 경로(저장소 기준) -> 이유.
export const EXCEPTIONS = {
  'tests/basket-link-postgres-browser.test.mjs':
    '로컬 증명 전용(playwright·embedded-postgres·pg 필요). docs/web-session-testing.md 참고',
};

const TEST_FILE = /\.test\.(mjs|cjs|js)$/;
const SKIP_DIRS = new Set(['node_modules', 'fixtures']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEST_FILE.test(name)) out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}

// workflow 텍스트에서 `node --test` 뒤의 tests/ 경로(glob 포함)를 모은다. 줄 끝 `\` 이음줄을 합친다.
export function workflowTestPatterns(text) {
  const joined = text.replace(/\\\r?\n/g, ' ');
  const patterns = [];
  for (const m of joined.matchAll(/node\s+--test\b([^\n]*)/g)) {
    for (const raw of m[1].split(/\s+/)) {
      const token = raw.replace(/^["']|["']$/g, '');
      if (token.startsWith('tests/')) patterns.push(token);
    }
  }
  return patterns;
}

export function globToRegExp(pattern) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + body + '$');
}

function authHandoffFiles(workflowTexts) {
  const wf = workflowTexts.get('authz-security-check.yml') || '';
  if (!/working-directory:\s*tests\/auth-handoff[\s\S]*?run:\s*npm test/.test(wf)) return [];
  const pkg = JSON.parse(readFileSync(join(root, 'tests/auth-handoff/package.json'), 'utf8'));
  return (pkg.scripts?.test || '').split(/\s+/).filter(t => TEST_FILE.test(t)).map(t => `tests/auth-handoff/${t}`);
}

export function findUnregistered() {
  const wfDir = join(root, '.github/workflows');
  const workflowTexts = new Map(
    readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)).map(f => [f, readFileSync(join(wfDir, f), 'utf8')]),
  );
  const patterns = [...workflowTexts.values()].flatMap(workflowTestPatterns).map(globToRegExp);
  const registered = new Set(authHandoffFiles(workflowTexts));
  const files = walk(join(root, 'tests'));
  for (const f of files) if (patterns.some(re => re.test(f))) registered.add(f);
  return {
    files,
    unregistered: files.filter(f => !registered.has(f) && !(f in EXCEPTIONS)),
    staleExceptions: Object.keys(EXCEPTIONS).filter(f => !files.includes(f) || registered.has(f)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {files, unregistered, staleExceptions} = findUnregistered();
  if (unregistered.length) {
    console.error('workflow에 등록되지 않은 단위 시험:\n' + unregistered.map(f => '  ' + f).join('\n'));
    console.error('해당 workflow의 `node --test` 목록에 추가하거나, 로컬 전용이면 scripts/check-test-registration.mjs의 EXCEPTIONS에 이유와 함께 적는다.');
  }
  if (staleExceptions.length) {
    console.error('더 이상 필요 없는 예외(파일이 없거나 이미 등록됨):\n' + staleExceptions.map(f => '  ' + f).join('\n'));
  }
  if (unregistered.length || staleExceptions.length) process.exit(1);
  console.log(`단위 시험 ${files.length}개 모두 workflow에 등록됨 (예외 ${Object.keys(EXCEPTIONS).length}개)`);
}
