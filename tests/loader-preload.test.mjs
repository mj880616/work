// PERF-첫로딩 P3·P4: loader-v2.js·view-loader.js의 미리 받기(modulepreload) 목록 검사.
// - 적힌 파일은 모두 저장소에 있고, 같은 loader가 실제로 import()하거나 그 정적 import 사슬 안에 든 파일이다(쓰지 않는 파일을 받지 않음).
// - P4: 소스 목록에는 뿌리만 적는다(/*static-chain*/). Pages 빌드(scripts/build-pages.mjs fillStaticChains)가 정적 사슬 전체를 채우고,
//   빌드 결과 검사는 scripts/build-pages-repo.test.mjs(빌드 도구가 있는 pages-build-check)에서 한다. 이 시험은 도구 없이 소스만 본다.
// - 기능 모듈 미리 받기는 로그인 확인(if(!authenticated)) 뒤에만 있다. 그 앞에는 로그인 확인에 쓰는 파일만(그 파일들은 정적 import 없음 → 빌드 뒤에도 같음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

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
test('미리 받기 목록은 loader가 실제로 부르는 파일과 그 정적 사슬뿐이다', () => {
  assert.ok(lists.length >= 3);
  const reachable = new Set(imported);
  for (const file of imported) for (const dep of closure(file)) reachable.add(dep);
  for (const {files} of lists) for (const file of files) {
    assert.ok(existsSync(new URL('../app/' + file, import.meta.url)), file + ' 없음');
    assert.ok(reachable.has(file), file + '은 loader가 부르지 않는 파일');
  }
});

test('소스 목록은 뿌리만 적는다(사슬은 빌드가 채움)', () => {
  assert.ok(loader.includes('/*static-chain*/') && views.includes('/*static-chain*/'));
  // 손으로 적은 사슬이 남지 않게: 소스 목록의 파일은 같은 목록 안 다른 파일의 정적 사슬에 들지 않는다.
  for (const {files} of [...lists, ...listsOf(views)]) for (const file of files) {
    for (const other of files) if (other !== file) assert.ok(!closure(other).has(file), file + '은 ' + other + '의 사슬 — 빌드가 채운다');
  }
  assert.ok(lists.some(l => l.files.includes('area-window.js')) && lists.some(l => l.files.includes('team.js')));
});

test('기능 모듈 미리 받기는 로그인 확인 뒤에만', () => {
  const authOnly = new Set(['auth-handoff-client.js', 'auth-bootstrap.js', 'auth-service.js']);
  const gate = loader.indexOf('if(!authenticated)');
  assert.ok(gate > 0);
  for (const {at, files} of lists) if (at < gate) for (const file of files) {
    assert.ok(authOnly.has(file), file + '을 로그인 확인 전에 받음');
    assert.equal(closure(file).size, 0, file + '에 정적 import가 생기면 빌드가 로그인 확인 전 목록에 그 사슬을 채운다');
  }
  assert.ok(lists.some(l => l.at > gate && l.files.includes('team.js')));
});

test('첫 화면 프로그램 사슬은 화면을 처음 부를 때 받기 시작하고, 담당조직은 목록만(P5)', () => {
  assert.match(views, /const firstModules=\{team:\/\*static-chain\*\/\['\.\/suborganizations\.js'\]\};/);
  assert.match(views, /async function prepare\(view\)\{\n\s*const key=normalize\(view\);\n\s*if\(!loaded\.has\(key\)\)for\(const path of firstModules\[key\]\|\|warmModules\[key\]\|\|\[\]\)hint\('modulepreload',path\);/);
  for (const file of ['workplace-detail.js', 'google-tasks.js']) assert.ok(!closure('suborganizations.js').has(file), '조직 상세(' + file + ')는 목록이 보인 뒤');
  // loader-v2는 view-loader가 실행되는 즉시 첫 화면을 prepare한다(그 순간 사슬 받기 시작).
  assert.match(loader, /import\('\.\/view-loader\.js'\)\.then\(\(\)=>\{const v=window\.KPTUViewLoader;void v\.prepare\(startRoute\(v\)\.requested\)\}\)/);
});
