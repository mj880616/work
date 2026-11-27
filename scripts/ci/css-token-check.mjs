#!/usr/bin/env node
// DESIGN-검증하네스 ②: 화면 CSS에 손으로 쓴 글자 크기·버튼 높이 px가 새로 늘지 않게 막는다.
//
// 대상: app/ 바로 아래 *.css (하위 폴더의 외부 라이브러리·로그인 화면 등은 뺀다).
// 뺀 파일: app/theme-tokens.css — 기준값(--ds-*)을 정하는 유일한 곳이라 px가 있어야 한다.
//
// 세는 것 두 가지(주석·문자열 안은 세지 않는다. 0px는 세지 않는다):
//   fontSize     : font-size 또는 font 줄임 선언의 값에 숫자px가 있으면 1곳.
//   buttonHeight : '버튼 선택자' 규칙 안의 height·min-height 선언 값에 숫자px가 있으면 1곳.
//   (var(--ds-...)만 쓰면 세지 않는다. calc(... + 2px)처럼 px가 섞이면 센다.)
//
// '버튼 선택자' 판별 규칙: 쉼표로 나눈 선택자 하나하나의 '맨 끝 대상'(마지막 결합자 뒤 조각,
// ::before 같은 가상 요소 포함)을 본다. 다음 중 하나면 버튼 선택자다.
//   1. 요소 이름 button
//   2. input[type=button|submit|reset]
//   3. [role=button]
//   4. 클래스·id 이름의 마지막 낱말이 btn 또는 button
//      (낱말은 '-'·'_'·대문자로 나눈다: .icon-btn, .basket-icon-button, #newEventBtn 은 버튼,
//       .btn-row, .wl-btns, .button-bar 처럼 버튼을 담는 줄·묶음은 버튼이 아니다)
// 한 규칙의 선택자 목록 중 하나라도 버튼 선택자면 그 규칙 전체를 버튼 규칙으로 센다.
//
// 기준선: scripts/ci/css-token-baseline.json (파일별 개수). 늘면 실패, 줄면 기준선도 같이 줄이라고
// 실패한다(기준선이 실제보다 크면 다른 곳에서 다시 늘어도 못 잡기 때문). 기준선 줄이기:
//   node scripts/ci/css-token-check.mjs --write-baseline
// --write-baseline은 줄이기만 한다(늘어난 파일이 있으면 쓰지 않고 실패).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../..');
export const baselinePath = resolve(here, 'css-token-baseline.json');
export const EXCLUDED = new Set(['theme-tokens.css']);
export const KINDS = ['fontSize', 'buttonHeight'];

const PX = /(^|[^\w.-])(\d*\.?\d+)px\b/g;
// var(--x, 13px)의 대신 값(fallback)은 기준값을 쓴 것으로 보고 세지 않는다(var(...) 통째를 지우고 본다).
export function withoutVars(value) {
  let out = '', i = 0;
  while (i < value.length) {
    const at = value.slice(i).search(/\bvar\(/i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, i + at) + 'var';
    let j = i + at + 4, depth = 1;
    while (j < value.length && depth) { if (value[j] === '(') depth++; else if (value[j] === ')') depth--; j++; }
    i = j;
  }
  return out;
}
export function hasPx(value) {
  for (const m of withoutVars(value).matchAll(PX)) if (Number(m[2]) !== 0) return true;
  return false;
}

function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1); i = j; continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1; continue;
    }
    out += c;
  }
  return out;
}

// 문자열·괄호를 건너뛰며 text[from]부터 stopChars 중 하나가 나오는 위치를 찾는다.
function scan(text, from, stopChars) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) { if (text[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && stopChars.includes(c)) return i;
  }
  return text.length;
}

function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) { if (text[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return text.length;
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

function splitTop(list) {
  const parts = []; let start = 0, depth = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(list.slice(start, i)); start = i + 1; }
  }
  parts.push(list.slice(start));
  return parts.map(s => s.trim()).filter(Boolean);
}

function subject(selector) {
  // 괄호·대괄호 밖의 마지막 결합자(공백 > + ~) 뒤 조각.
  let depth = 0, cut = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) cut = i + 1;
  }
  return selector.slice(cut);
}

function lastWord(name) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').split(/[-_]+/).filter(Boolean);
  return (words.at(-1) || '').toLowerCase();
}

export function isButtonSelector(selector) {
  // :not(...)·:is(...) 안쪽은 대상이 아니므로 지우고 본다.
  const s = subject(selector).replace(/:(?:not|has)\([^()]*\)/g, '');
  if (/^button(?![\w-])/i.test(s)) return true;
  if (/(^|[^\w-])input\b[^\s]*\[type\s*=\s*["']?(?:button|submit|reset)["']?\s*\]/i.test(s)) return true;
  if (/\[role\s*=\s*["']?button["']?\s*\]/i.test(s)) return true;
  for (const m of s.matchAll(/[.#]((?:\\.|[\w-])+)/g)) {
    const w = lastWord(m[1]);
    if (w === 'btn' || w === 'button') return true;
  }
  // :is(button, .x-btn) 처럼 대상 조각 안에 목록이 있으면 그 안쪽도 본다.
  for (const m of s.matchAll(/:(?:is|where)\(([^()]*)\)/g)) {
    if (splitTop(m[1]).some(isButtonSelector)) return true;
  }
  return false;
}

export function isButtonRule(selectorList) {
  return splitTop(selectorList).some(isButtonSelector);
}

function combine(parent, child) {
  if (!parent) return child;
  const outer = splitTop(parent);
  return splitTop(child).flatMap(c => c.includes('&')
    ? outer.map(p => c.replaceAll('&', p))
    : outer.map(p => `${p} ${c}`)).join(', ');
}

// CSS 본문에서 세는 곳 목록 [{kind, line, prop, value, selector}]을 돌려준다.
export function findings(cssText) {
  const text = stripComments(cssText);
  const out = [];
  function walk(from, to, selector, inKeyframes) {
    let i = from;
    while (i < to) {
      while (i < to && /[\s;]/.test(text[i])) i++;
      if (i >= to) break;
      const stop = scan(text, i, ';{}');
      const end = Math.min(stop, to);
      const head = text.slice(i, end).trim();
      if (end < to && text[end] === '{') {
        const close = Math.min(matchingBrace(text, end), to);
        if (head.startsWith('@')) {
          const keyframes = /^@(?:-\w+-)?keyframes\b/i.test(head);
          const passSelector = /^@(?:media|supports|container|layer|document|scope)\b/i.test(head) ? selector : '';
          walk(end + 1, close, passSelector, inKeyframes || keyframes);
        } else {
          walk(end + 1, close, inKeyframes ? '' : combine(selector, head), inKeyframes);
        }
        i = close + 1;
        continue;
      }
      // 선언 한 줄
      const colon = head.indexOf(':');
      if (colon > 0 && !head.startsWith('@')) {
        const prop = head.slice(0, colon).trim().toLowerCase();
        const value = head.slice(colon + 1).trim();
        const line = lineAt(text, i);
        if ((prop === 'font-size' || prop === 'font') && hasPx(value)) {
          out.push({ kind: 'fontSize', line, prop, value, selector });
        } else if ((prop === 'height' || prop === 'min-height') && selector && hasPx(value) && isButtonRule(selector)) {
          out.push({ kind: 'buttonHeight', line, prop, value, selector });
        }
      }
      i = end + 1;
    }
  }
  walk(0, text.length, '', false);
  return out;
}

export function targetFiles(root = repoRoot) {
  return readdirSync(resolve(root, 'app'))
    .filter(f => f.endsWith('.css') && !EXCLUDED.has(f))
    .sort();
}

export function countAll(root = repoRoot) {
  const counts = {};
  for (const file of targetFiles(root)) {
    const list = findings(readFileSync(resolve(root, 'app', file), 'utf8'));
    const c = { fontSize: 0, buttonHeight: 0 };
    for (const f of list) c[f.kind]++;
    if (c.fontSize || c.buttonHeight) counts[`app/${file}`] = c;
  }
  return counts;
}

const LABEL = { fontSize: '글자 크기(font-size px)', buttonHeight: '버튼 높이(height px)' };

// 실제 개수와 기준선을 비교한다. {grown:[], shrunk:[], stale:[]}
export function compare(counts, baseline) {
  const grown = [], shrunk = [];
  const files = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    for (const kind of KINDS) {
      const now = counts[file]?.[kind] ?? 0;
      const base = baseline[file]?.[kind] ?? 0;
      if (now > base) grown.push({ file, kind, now, base });
      else if (now < base) shrunk.push({ file, kind, now, base });
    }
  }
  return { grown, shrunk };
}

export function lowered(counts, baseline) {
  const next = {};
  for (const file of Object.keys(baseline).sort()) {
    const c = {};
    for (const kind of KINDS) c[kind] = Math.min(baseline[file]?.[kind] ?? 0, counts[file]?.[kind] ?? 0);
    if (c.fontSize || c.buttonHeight) next[file] = c;
  }
  return next;
}

function main(argv) {
  const counts = countAll();
  if (argv.includes('--print')) {
    console.log(JSON.stringify(counts, null, 2));
    return 0;
  }
  if (argv.includes('--list')) {
    const only = argv[argv.indexOf('--list') + 1];
    for (const file of targetFiles()) {
      if (only && !only.startsWith('-') && `app/${file}` !== only && file !== only) continue;
      for (const f of findings(readFileSync(resolve(repoRoot, 'app', file), 'utf8'))) {
        console.log(`app/${file}:${f.line} ${f.kind} ${f.prop}: ${f.value}`);
      }
    }
    return 0;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).files;
  const { grown, shrunk } = compare(counts, baseline);
  if (argv.includes('--write-baseline')) {
    if (grown.length) {
      for (const g of grown) console.error(`늘어남: ${g.file} ${LABEL[g.kind]} ${g.base} → ${g.now}`);
      console.error('기준선은 줄이기만 한다. 늘어난 px를 var(--ds-*)로 바꾼 뒤 다시 실행하세요.');
      return 1;
    }
    const doc = JSON.parse(readFileSync(baselinePath, 'utf8'));
    doc.files = lowered(counts, baseline);
    writeFileSync(baselinePath, JSON.stringify(doc, null, 2) + '\n');
    console.log(`기준선을 줄였습니다(${shrunk.length}곳).`);
    return 0;
  }
  let fail = false;
  for (const g of grown) {
    fail = true;
    console.error(`실패: ${g.file} ${LABEL[g.kind]}가 기준선 ${g.base}곳 → ${g.now}곳으로 늘었습니다.`);
    const list = findings(readFileSync(resolve(repoRoot, g.file), 'utf8')).filter(f => f.kind === g.kind);
    for (const f of list) console.error(`  ${g.file}:${f.line} ${f.prop}: ${f.value}`);
  }
  if (grown.length) {
    console.error('새 글자 크기·버튼 높이는 app/theme-tokens.css의 var(--ds-*) 기준값을 쓰세요(docs/design-decisions.md UI-버튼기준).');
  }
  for (const s of shrunk) {
    fail = true;
    console.error(`기준선 줄이기 필요: ${s.file} ${LABEL[s.kind]}가 ${s.base}곳 → ${s.now}곳으로 줄었습니다. ` +
      '`node scripts/ci/css-token-check.mjs --write-baseline`으로 기준선(scripts/ci/css-token-baseline.json)도 같이 줄여 커밋하세요.');
  }
  if (fail) return 1;
  const total = KINDS.map(k => Object.values(counts).reduce((a, c) => a + c[k], 0));
  console.log(`CSS 기준값 검사 통과: 글자 크기 px ${total[0]}곳, 버튼 높이 px ${total[1]}곳(기준선과 같음).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
