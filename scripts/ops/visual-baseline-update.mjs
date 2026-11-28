#!/usr/bin/env node
// CI-기준사진갱신: 기준 사진을 CI에서 찍어 PR 브랜치에 커밋하는 수동 workflow(.github/workflows/visual-baseline-update.yml)의 검사 도우미.
// workflow는 이 파일을 늘 main 쪽 체크아웃에서 부른다(PR 코드로 검사하지 않음). 모든 검사는 실패하면 종료 코드 1.
//
// 사용:
//   check-input <pr> <names>                 → GITHUB_OUTPUT: pr, grep
//   check-pr <pr.json> <repo> <default 브랜치> → GITHUB_OUTPUT: head_ref, head_sha
//   pick <받은 폴더> <넣을 폴더>               → 이름·PNG 모양이 맞는 사진만 옮긴다
//   check-changes <git status -z 파일>        → 기준 사진 PNG 말고 바뀐 파일이 있으면 실패, GITHUB_OUTPUT: count, label
//   summary <저장소 폴더> <git status -z 파일> → GITHUB_STEP_SUMMARY에 바뀐 사진·크기 차이 표
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SNAP_DIR = 'tests/app-e2e/visual-baseline.spec.mjs-snapshots';
const SNAP_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(pc|phone|fold)-chromium-linux\.png$/;
const NAME_ITEM = /^([a-z0-9]+(?:-[a-z0-9]+)*):(pc|phone|fold)$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_PNG_BYTES = 5 * 1024 * 1024;
export const MAX_NAMES = 40;

const WIDTH = { pc: 1280, phone: 412, fold: 712 };

// PR 번호: 1~7자리 숫자만.
export function checkPrNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!/^[1-9][0-9]{0,6}$/.test(s)) throw new Error(`PR 번호가 숫자가 아닙니다: ${JSON.stringify(s)}`);
  return s;
}

// 'home:phone, note:phone,library:pc' → [{name:'home',tag:'phone'},…]. 비우면 [](= 그 PR에서 틀린 것만).
export function parseNames(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const items = s.split(',').map(x => x.trim()).filter(Boolean);
  if (items.length > MAX_NAMES) throw new Error(`이름이 너무 많습니다(${items.length}개, 최대 ${MAX_NAMES})`);
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const m = NAME_ITEM.exec(item);
    if (!m) throw new Error(`이름 모양이 틀렸습니다: ${JSON.stringify(item)} (예: home:phone, library:pc)`);
    if (seen.has(item)) continue;
    seen.add(item);
    out.push({ name: m[1], tag: m[2] });
  }
  return out;
}

// 시험 제목 `기준 사진 ${name} (${tag} ${width}px)`만 고르는 --grep 정규식. 빈 목록이면 ''(전체 기준 사진 시험).
export function grepFor(names) {
  if (!names.length) return '';
  return `기준 사진 (${names.map(({ name, tag }) => `${name} \\(${tag} ${WIDTH[tag]}px\\)`).join('|')})$`;
}

export function checkPr(pr, repo, defaultBranch) {
  if (!pr || typeof pr !== 'object') throw new Error('PR 정보를 읽지 못했습니다');
  if (pr.state !== 'open') throw new Error(`열린 PR이 아닙니다(state=${pr.state})`);
  const headRepo = pr.head?.repo?.full_name;
  if (!headRepo || headRepo !== repo) throw new Error(`다른 저장소(포크) 브랜치는 받지 않습니다: ${headRepo || '없음'}`);
  if (pr.base?.repo?.full_name !== repo) throw new Error('이 저장소 PR이 아닙니다');
  const ref = String(pr.head?.ref ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/.test(ref) || ref.includes('..') || ref.endsWith('.lock') || ref.endsWith('/')) {
    throw new Error(`브랜치 이름이 허용 모양이 아닙니다: ${JSON.stringify(ref)}`);
  }
  const blocked = new Set(['main', 'master', 'gh-pages', String(defaultBranch || '')]);
  if (blocked.has(ref)) throw new Error(`기본 브랜치(${ref})에는 커밋하지 않습니다`);
  const sha = String(pr.head?.sha ?? '');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('head SHA가 없습니다');
  return { headRef: ref, headSha: sha };
}

// git status --porcelain=v1 -z 결과 → [{code, path}]. 이름 바뀜(R·C)은 다음 칸(옛 이름)까지 함께 경로로 본다.
export function parseStatusZ(text) {
  const parts = String(text).split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    out.push({ code, path: parts[i].slice(3) });
    if (code[0] === 'R' || code[0] === 'C') out.push({ code, path: parts[++i] ?? '' });
  }
  return out;
}

// 바뀐 파일이 모두 기준 사진 PNG(추가·수정)인지. 지움·이름 바뀜·다른 파일이 하나라도 있으면 실패.
export function checkChanges(entries) {
  const bad = [];
  const ok = [];
  for (const { code, path } of entries) {
    const inDir = path.startsWith(`${SNAP_DIR}/`) && SNAP_FILE.test(path.slice(SNAP_DIR.length + 1));
    const allowedCode = code === '??' || code === ' M' || code === 'M ' || code === 'A ';
    if (inDir && allowedCode) ok.push(path);
    else bad.push(`${code.trim() || '?'} ${path}`);
  }
  if (bad.length) throw new Error(`기준 사진 말고 바뀐 파일이 있어 멈춥니다:\n${bad.join('\n')}`);
  return [...new Set(ok)].sort();
}

// 파일 경로 → 'home:phone'.
export function labelOf(path) {
  const m = SNAP_FILE.exec(path.split('/').pop());
  return m ? `${m[1]}:${m[2]}` : path;
}

export function isPng(buf) {
  return buf.length > PNG_MAGIC.length && buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

// 받은 폴더(아래 폴더 포함)에서 기준 사진 이름·PNG 모양·크기 한도가 맞는 파일만 넣을 폴더로 옮긴다(경로는 쓰지 않고 이름만).
export function pick(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  const picked = [];
  const skipped = [];
  const walk = dir => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isSymbolicLink()) { skipped.push(ent.name); continue; }
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.isFile() || !SNAP_FILE.test(ent.name)) { skipped.push(ent.name); continue; }
      const size = statSync(full).size;
      if (size > MAX_PNG_BYTES || !isPng(readFileSync(full))) { skipped.push(ent.name); continue; }
      if (picked.includes(ent.name)) throw new Error(`같은 이름 사진이 둘입니다: ${ent.name}`);
      copyFileSync(full, join(toDir, ent.name));
      picked.push(ent.name);
    }
  };
  walk(fromDir);
  if (skipped.length) throw new Error(`기준 사진 모양이 아닌 파일이 들어 있어 멈춥니다: ${skipped.join(', ')}`);
  return picked.sort();
}

export function sizeRows(files, oldSize, newSize) {
  return files.map(f => {
    const before = oldSize(f);
    const after = newSize(f);
    const diff = before == null ? '새 사진' : `${after - before >= 0 ? '+' : ''}${after - before}`;
    return `| ${labelOf(f)} | ${before == null ? '없음' : before} | ${after} | ${diff} |`;
  });
}

function out(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`${name}=${value}`);
}
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  console.log(text);
}

function main([cmd, ...args]) {
  switch (cmd) {
    case 'check-input': {
      const pr = checkPrNumber(args[0]);
      const names = parseNames(args[1]);
      out('pr', pr);
      out('grep', grepFor(names));
      summary(names.length ? `고른 기준 사진: ${names.map(n => `${n.name}:${n.tag}`).join(', ')}` : '고른 이름 없음: 이 PR에서 기준과 다른 사진만 갱신');
      return;
    }
    case 'check-pr': {
      const pr = JSON.parse(readFileSync(args[0], 'utf8'));
      const { headRef, headSha } = checkPr(pr, args[1], args[2]);
      out('head_ref', headRef);
      out('head_sha', headSha);
      summary(`PR #${pr.number} · 브랜치 \`${headRef}\` · head \`${headSha.slice(0, 12)}\``);
      return;
    }
    case 'pick': {
      const picked = pick(args[0], args[1]);
      console.log(`옮긴 사진 ${picked.length}개: ${picked.join(', ')}`);
      return;
    }
    case 'check-changes': {
      const files = checkChanges(parseStatusZ(readFileSync(args[0], 'utf8')));
      out('count', String(files.length));
      out('label', files.map(labelOf).join(','));
      return;
    }
    case 'summary': {
      const [repoDir, statusFile] = args;
      const files = checkChanges(parseStatusZ(readFileSync(statusFile, 'utf8')));
      if (!files.length) { summary('바뀐 기준 사진 없음(모두 기준과 같음). 커밋하지 않았습니다.'); return; }
      const oldSize = f => {
        try { return Number(execFileSync('git', ['-C', repoDir, 'cat-file', '-s', `HEAD:${f}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { return null; }
      };
      const newSize = f => statSync(join(repoDir, f)).size;
      summary([`### 바뀐 기준 사진 ${files.length}개`, '', '| 사진 | 전(바이트) | 후(바이트) | 차이 |', '| --- | --- | --- | --- |', ...sizeRows(files, oldSize, newSize)].join('\n'));
      return;
    }
    default:
      throw new Error(`모르는 명령: ${cmd}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`::error::${String(e.message).split('\n')[0]}`); console.error(e.message); process.exit(1); }
}
