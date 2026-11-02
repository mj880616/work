// PERF-첫로딩 P3·P4: loader-v2.js·view-loader.js의 미리 받기(modulepreload) 목록 검사.
// - 적힌 파일은 모두 저장소에 있고, 같은 loader가 실제로 import()하거나 그 정적 import 사슬 안에 든 파일이다(쓰지 않는 파일을 받지 않음).
// - P4: 소스 목록에는 뿌리만 적고(/*static-chain*/), Pages 빌드(scripts/build-pages.mjs fillStaticChains)가 정적 사슬 전체를 채운다.
//   빌드 결과에서 창 그릇(area-window.js)·앱 바탕(team.js)·화면 첫 프로그램의 정적 사슬이 빠짐없이 들어가는지 본다.
// - 기능 모듈 미리 받기는 로그인 확인(if(!authenticated)) 뒤에만 있다. 그 앞에는 로그인 확인에 쓰는 파일만(빌드가 채운 뒤에도).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fillStaticChains, staticChain, chainMark} from '../scripts/build-pages.mjs';

const read = file => readFileSync(new URL('../app/' + file, import.meta.url), 'utf8');
const loader = read('loader-v2.js');
const views = read('view-loader.js');
const staticImports = file => [...read(file).matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.\/[^'"]+)['"]/gm)].map(m => m[1].slice(2));
function closure(file, seen = new Set()) {
  for (const dep of staticImports(file)) if (!seen.has(dep)) { seen.add(dep); closure(dep, seen); }
  return seen;
}
const listsOf = source => [...source.matchAll(/(?:preload\(|:)\/\*static-chain\*\/\[([^\]]*)\]/g)].map(m => ({at: m.index, files: [...m[1].matchAll(/'\.\/([^'?]+)[^']*'/g)].map(x => x[1])}));
const lists = listsOf(loader);
const imported = [...loader.matchAll(/import\('\.\/([^']+)'\)/g)].map(m => m[1]);
// 빌드가 채운 판(해시 번호는 빼고 본다): 앱 파일만 넣어 같은 함수를 돌린다.
const tree = {};
for (const file of new Set([...imported, ...closureAll(['loader-v2.js', 'view-loader.js', ...imported])])) if (existsSync(new URL('../app/' + file, import.meta.url))) tree['app/' + file] = read(file);
function closureAll(roots) {
  const out = new Set(roots);
  for (const root of roots) {
    if (!existsSync(new URL('../app/' + root, import.meta.url))) continue;
    for (const {files} of listsOf(read(root))) for (const file of files) { out.add(file); for (const dep of closure(file)) out.add(dep); }
    for (const dep of closure(root)) out.add(dep);
  }
  return out;
}
const built = fillStaticChains(tree);
const builtLoader = listsOf(built['app/loader-v2.js']);
const builtViews = listsOf(built['app/view-loader.js']);

test('미리 받기 목록은 loader가 실제로 부르는 파일과 그 정적 사슬뿐이다', () => {
  assert.ok(lists.length >= 3);
  const reachable = new Set(imported);
  for (const file of imported) for (const dep of closure(file)) reachable.add(dep);
  for (const {files} of [...lists, ...builtLoader]) for (const file of files) {
    assert.ok(existsSync(new URL('../app/' + file, import.meta.url)), file + ' 없음');
    assert.ok(reachable.has(file), file + '은 loader가 부르지 않는 파일');
  }
});

test('소스 목록은 뿌리만, 빌드가 정적 사슬을 빠짐없이 채운다', () => {
  assert.ok(loader.includes(chainMark) && views.includes(chainMark));
  // 손으로 적은 사슬이 남지 않게: 소스 목록의 파일은 같은 목록 안 다른 파일의 정적 사슬에 들지 않는다.
  for (const {files} of [...lists, ...listsOf(views)]) for (const file of files) {
    for (const other of files) if (other !== file) assert.ok(!closure(other).has(file), file + '은 ' + other + '의 사슬 — 빌드가 채운다');
  }
  const listed = new Set(builtLoader.flatMap(l => l.files));
  for (const root of ['area-window.js', 'team.js', 'topbar-actions.js']) {
    for (const file of [root, ...closure(root)]) assert.ok(listed.has(file), root + ' 사슬의 ' + file + ' 빠짐');
  }
  for (const {files} of builtViews) {
    const roots = files.filter(file => !files.some(other => other !== file && closure(other).has(file)));
    for (const root of roots) for (const file of closure(root)) assert.ok(files.includes(file), root + ' 사슬의 ' + file + ' 빠짐(view-loader)');
  }
  assert.deepEqual(staticChain(tree, ['app/area-window.js']).map(f => f.slice(4)).sort(), [...closure('area-window.js')].sort());
});

test('기능 모듈 미리 받기는 로그인 확인 뒤에만(빌드가 채운 뒤에도)', () => {
  const authOnly = new Set(['auth-handoff-client.js', 'auth-bootstrap.js', 'auth-service.js']);
  for (const [source, found] of [[loader, lists], [built['app/loader-v2.js'], builtLoader]]) {
    const gate = source.indexOf('if(!authenticated)');
    assert.ok(gate > 0);
    for (const {at, files} of found) if (at < gate) for (const file of files) assert.ok(authOnly.has(file), file + '을 로그인 확인 전에 받음');
    assert.ok(found.some(l => l.at > gate && l.files.includes('team.js')));
  }
});

test('첫 화면 프로그램 사슬은 화면을 처음 부를 때 받기 시작하고, 담당조직은 목록만(P5)', () => {
  assert.match(views, /const firstModules=\{team:\/\*static-chain\*\/\['\.\/suborganizations\.js'\]\};/);
  assert.match(views, /async function prepare\(view\)\{\n\s*const key=normalize\(view\);\n\s*if\(!loaded\.has\(key\)\)for\(const path of firstModules\[key\]\|\|warmModules\[key\]\|\|\[\]\)hint\('modulepreload',path\);/);
  const team = listsOf(built['app/view-loader.js'].slice(0, built['app/view-loader.js'].indexOf('async function prepare')))[0].files;
  assert.ok(!team.includes('workplace-detail.js') && !team.includes('google-tasks.js'), '조직 상세는 목록이 보인 뒤');
  // loader-v2는 view-loader가 실행되는 즉시 첫 화면을 prepare한다(그 순간 사슬 받기 시작).
  assert.match(loader, /import\('\.\/view-loader\.js'\)\.then\(\(\)=>\{const v=window\.KPTUViewLoader;void v\.prepare\(startRoute\(v\)\.requested\)\}\)/);
});
