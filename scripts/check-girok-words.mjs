import { parse } from 'acorn';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FACES, wordIn } from '../app/brand/faces.mjs';
import { GIROK_ALLOW } from './girok-words-allow.mjs';

// APP-올인원다이어리 단계 3(단어, S67-43): 기록+ 화면에 노조 색 글자가 나오지 않는지 전수 검사한다.
//  1. app/의 JS 고정 글자(문자열·템플릿 조각) 중 금지어가 든 것은 word()·word`…`를 거쳐야 한다.
//     거친 글자는 기록+ 단어표로 바꾼 뒤에도 금지어가 없어야 한다.
//  2. 기록+ 빌드 HTML의 눈에 보이는 글자(태그 사이·aria-label·alt·title·placeholder)에 금지어가 없어야 한다.
//  예외는 scripts/girok-words-allow.mjs 한 곳(화면에 안 나오는 글자: 데이터 값·사용자 글 읽기·서버로 보내는 글·꺼진 화면).
// 주석·정규식·import 경로·객체 열쇠는 화면 글자가 아니라 보지 않는다.
export const FORBIDDEN = /노동조합|노조|조합원|투쟁|교섭|상집|담당\s?조직|사업\s?영역|사업\s?보고|사업\s?관리|조직|국회|성명서|단협|위원장|지부|지회|쟁의|파업|사업장/;

const VENDOR = /(?:^|\/)(?:[^/]*-\d+\.\d+(?:\.\d+)?[^/]*|node_modules|hwp-lab\/rhwp[^/]*)\//;
const girok = FACES.girok;
const allowed = (file, text) => GIROK_ALLOW.find(rule => (rule.file === file || (rule.file.endsWith('/') && file.startsWith(rule.file))) && (rule.text === undefined || text.includes(rule.text)));

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, visit, node);
    else if (value && typeof value.type === 'string') walk(value, visit, node);
  }
}

const isWord = node => node?.type === 'Identifier' && (node.name === 'word' || node.name === 'brandWord');

/** JS 한 파일: [{line, text, why}] 문제 목록. */
export function scanScript(file, source, { sourceType } = {}) {
  let ast;
  for (const type of sourceType ? [sourceType] : ['module', 'script']) {
    try { ast = parse(source, { ecmaVersion: 'latest', sourceType: type, locations: true, allowHashBang: true }); break; } catch (error) { if (type === 'script' || sourceType) throw new Error(`${file}: ${error.message}`); }
  }
  const problems = [];
  const parents = new Map();
  walk(ast, (node, parent) => parents.set(node, parent));
  const check = (node, text) => {
    if (!FORBIDDEN.test(text)) return;
    const parent = parents.get(node);
    let through = false;
    if (node.type === 'Literal') {
      if (parent?.type === 'CallExpression' && isWord(parent.callee) && parent.arguments.includes(node)) through = true;
      if ((parent?.type === 'Property' || parent?.type === 'PropertyDefinition') && parent.key === node && !parent.computed) return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(parent?.type)) return;
    } else {
      const literal = parent, holder = parents.get(literal);
      if (holder?.type === 'TaggedTemplateExpression' && isWord(holder.tag)) through = true;
      if (holder?.type === 'CallExpression' && isWord(holder.callee) && holder.arguments.includes(literal)) through = true;
    }
    if (through) {
      const shown = wordIn(girok, text);
      if (FORBIDDEN.test(shown)) problems.push({ file, line: node.loc.start.line, text, why: `단어표를 거쳐도 남음: ${shown}` });
      return;
    }
    if (allowed(file, text)) return;
    problems.push({ file, line: node.loc.start.line, text, why: 'word()를 거치지 않음' });
  };
  walk(ast, node => {
    if (node.type === 'Literal' && typeof node.value === 'string' && !node.regex) check(node, node.value);
    if (node.type === 'TemplateElement') check(node, node.value.cooked ?? node.value.raw);
  });
  return problems;
}

/** 기록+ 빌드 HTML 한 장의 눈에 보이는 글자. */
export function visibleHtml(html) {
  const outside = html.split(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/).join('\n');
  return [
    ...[...outside.matchAll(/>([^<>]+)</g)].map(m => m[1].trim()).filter(Boolean),
    ...[...outside.matchAll(/\s(?:aria-label|alt|title|placeholder)="([^"]*)"/g)].map(m => m[1])
  ];
}

export function scanHtml(file, html) {
  const problems = [];
  for (const text of visibleHtml(html)) if (FORBIDDEN.test(text) && !allowed(file, text)) problems.push({ file, line: 0, text, why: 'HTML 화면 글자' });
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(match[1]) || /type="(?:application\/(?:ld\+)?json|importmap)"/.test(match[1]) || !match[2].trim()) continue;
    problems.push(...scanScript(file, match[2], { sourceType: /type="module"/.test(match[1]) ? 'module' : 'script' }));
  }
  return problems;
}

function listFiles(root, dir = 'app') {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (VENDOR.test(`${path}/`)) continue;
    if (statSync(join(root, path)).isDirectory()) out.push(...listFiles(root, path));
    else if (/\.(?:m?js|html)$/.test(name)) out.push(path);
  }
  return out;
}

/** root: 기록+ 빌드 출력 폴더(또는 저장소). */
export function checkGirokWords(root) {
  const problems = [];
  for (const file of listFiles(root)) {
    const source = readFileSync(join(root, file), 'utf8');
    problems.push(...(file.endsWith('.html') ? scanHtml(file, source) : scanScript(file, source)));
  }
  return { problems };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  const root = resolve(process.argv[2] || '.');
  const { problems } = checkGirokWords(root);
  for (const p of problems) console.log(`${p.file}:${p.line}\t${p.why}\t${JSON.stringify(p.text).slice(0, 160)}`);
  console.log(`기록+ 금지어 검사(${relative(process.cwd(), root) || '.'}): 문제 ${problems.length}개`);
  if (problems.length) process.exitCode = 1;
}
