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

// PERF-첫로딩 P5-b: 사업 보고 화면·입력 창 전용 모듈은 team.js 정적 사슬(홈 보이기 전 앱 바탕)에 들지 않고,
// team-report-kit.js 한 묶음으로 사업 보고 자료를 읽을 때 부른다. 쉬는 틈 미리 받기(meetings)는 그 묶음 사슬을 받는다.
test('P5-b: 사업 보고 전용 묶음은 team.js 정적 사슬 밖, 사업 보고를 열 때 부른다', () => {
  const team = read('team.js');
  const kitOnly = [...closure('team-report-kit.js')].filter(file => !closure('team.js').has(file));
  for (const file of ['report-views.js', 'meeting-columns.js', 'report-kind-sheet.js', 'record-text-write.js', 'business-area-fields.js', 'split-resize.js', 'follow-pane.js', 'filter-chips.js', 'report-photo-row.js'])
    assert.ok(kitOnly.includes(file), file + '이 아직 team.js 정적 사슬에 있음');
  assert.ok(kitOnly.length >= 20, '빠진 모듈 수 ' + kitOnly.length);
  assert.ok(!staticImports('team-report-kit.js').includes('time-input.js'), '앱 전체 시간 칸 모듈은 team.js에 남김');
  assert.ok(staticImports('team.js').includes('time-input.js'));
  assert.match(team, /import\('\.\/team-report-kit\.js'\)/);
  // 사업 보고 자료 읽기와 함께 묶음을 기다린다(그리기 전), 연결 다시 읽기도 묶음을 먼저 부른다.
  assert.match(team, /created_at\.desc'\),\s*reportKit\(\)\s*\]\);/);
  assert.match(team, /async function loadReportLinks\(\)\{\s*try\{await reportKit\(\)\}/);
  // 묶음 전에는 사업 보고 화면을 그리지 않는다(그리는 주인 renderMeetings 하나는 그대로).
  assert.match(team, /function renderMeetings\(opts\)\{const box=\$\('#meetingList'\);if\(!box\|\|!reportKitLoaded\)return;/);
  const warm = listsOf(views).find(({files}) => files.includes('meeting-round-detail.js'));
  assert.equal(warm?.files[0], 'team-report-kit.js');
});

// PERF-첫로딩 P5-c: 홈 [주간 정리] 묶음(journal-weekly-kit.js)은 앱이 보인 뒤 부르는데, 그 정적 사슬(약 75개)을 단계마다 줄 서서 받으면
// 폰에서 홈 뒤 쉬는 틈 미리 받기·달력 첫 전환과 겹친다(S48-34 측정: 달력 첫 전환 새 JS 11 → 24, 늦게 온 것은 주간 정리 사슬).
// 부르기 직전에 view-loader 받기 도구로 사슬 전체를 한꺼번에 받기 시작한다(뿌리만 적고 빌드가 사슬을 채움, 실행은 import() 그대로).
test('P5-c: 홈 주간 정리 묶음은 부르기 직전에 정적 사슬을 한꺼번에 받기 시작한다', () => {
  const journal = read('journal.js');
  assert.match(views, /function preload\(paths\)\{for\(const path of paths\|\|\[\]\)hint\('modulepreload',path\)\}/);
  assert.match(views, /window\.KPTUViewLoader=\{[^}]*\bpreload\b/);
  assert.match(journal, /window\.KPTUViewLoader\?\.preload\?\.\(\/\*static-chain\*\/\['\.\/journal-weekly-kit\.js'\]\); return import\('\.\/journal-weekly-kit\.js'\);/);
  // 묶음은 여전히 홈 첫 화면 정적 사슬 밖(앱이 보인 뒤 부름).
  assert.ok(!closure('journal.js').has('journal-weekly-kit.js'));
});

// PERF-첫로딩 P5-c: 사업 보고 사슬(P5-b 묶음 포함)은 다른 화면 미리 받기를 다 받은 뒤 다음 쉬는 틈에. 나머지는 전처럼 한꺼번에.
// 한꺼번에 걸면 폰에서 그 묶음의 받기·해석이 먼저 누를 화면과 다툰다(S48-34 측정: 달력 첫 전환 775 → 1359ms).
test('P5-c: 사업 보고 미리 받기는 다른 화면 미리 받기 뒤 쉬는 틈에', () => {
  const warm = views.slice(views.indexOf('const warmLater='), views.indexOf('// PERF-첫로딩 P5-c: 화면 안에서'));
  assert.match(warm, /const warmLater=new Set\(\['meetings'\]\);/);
  assert.match(warm, /const first=warmViews\(views\.filter\(\(\[view\]\)=>!warmLater\.has\(view\)\),have\);/);
  assert.match(warm, /Promise\.all\(first\.map\(settled\)\)\.then\(\(\)=>idle\(\(\)=>warmViews\(views\.filter\(\(\[view\]\)=>warmLater\.has\(view\)\),have\)\)\)/);
  assert.match(warm, /if\(loaded\.has\(view\)\)continue;/);
  // 받기만(modulepreload·prefetch) — 실행·기기 저장 없음.
  assert.doesNotMatch(warm, /import\(|localStorage|sessionStorage/);
  // 사업 보고를 누르면 prepare가 같은 사슬을 바로 받는다.
  assert.match(views, /if\(!loaded\.has\(key\)\)for\(const path of firstModules\[key\]\|\|warmModules\[key\]\|\|\[\]\)hint\('modulepreload',path\);/);
});
