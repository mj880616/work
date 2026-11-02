// S48-30 화면 다듬기 2: 요청함 11/02 00:38 '놓친 작업' 17·18·20·21·22·23·C5를 한 번에 고친 자리가 다시 어긋나지 않게 소스로 지킨다.
// 화면 동작은 tests/app-e2e/ui-polish-2.spec.mjs와 기존 E2E가 본다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('④ 원장·챙길 것 출처 이름은 "업무일지"(앱 전체에 "일지"만 따로 쓴 화면 글자 없음)', async () => {
  const {ORIGIN_SOURCE_LABEL} = await import('../app/ledger-candidate-model.mjs');
  assert.equal(ORIGIN_SOURCE_LABEL.work, '업무일지');
  assert.match(read('app/todo-radar-data.js'), /work:'업무일지'/);
  // 문자열 안에 '일지'가 '업무일지'가 아닌 채로 나오는 곳(주석 줄 제외)이 없다. 사진·아스날 자료 같은 데이터 파일은 뺀다.
  const bad = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) { if (!['hwp-lab', 'arsenal', 'release-notes', 'editor-lib', 'markdown-lib', 'legacy'].includes(name)) walk(p); continue; }
    if (!/\.(m?js|html)$/.test(name)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; for (const m of line.matchAll(/(['"`>])([^'"`<\n]{0,30}?)(?<!업무)(?<!주간 업무)일지(?![가-힣]*업무)/g)) { const before = m[2]; if (/[가-힣]$/.test(before) && !/ $/.test(before)) continue; bad.push(`${p}:${i + 1}: ${line.trim().slice(0, 80)}`); } }); } };
  walk(new URL('../app', import.meta.url).pathname);
  assert.deepEqual(bad, []);
});

test('② 새로고침 제자리: 사업 보고 칸·고른 보고, 할 일 상세가 라우터 주소 칸으로 적힌다(기기 저장 없음)', () => {
  const router = read('app/app-router.js');
  assert.match(router, /meetings:\['areas','chip','report'\]/);
  assert.match(router, /tasks:\['task'\]/);
  const team = read('app/team.js');
  assert.match(team, /function restoreReportPlace\(\)/);
  assert.match(team, /setPlace\?\.\('meetings',\{chip:reportChip===DEFAULT_KIND\?null:reportChip,report:/);
  assert.match(team, /restoreReportPlace\(\);renderMeetings\(\);/);
  assert.match(team, /;writeReportPlace\(\)\}/, 'renderMeetings가 그린 뒤 한 곳에서 적는다');
  const tasks = read('app/google-tasks.js');
  assert.match(tasks, /setPlace\?\.\('tasks',\{task:task\?\.id\|\|null\}\)/);
  assert.match(tasks, /function closeEditor\(\)\{[^}]*taskPlace\(null\)/);
  // 자리 쓰기·읽기는 라우터 주소 칸만(기기 저장 없음).
  for (const fn of [read('app/team.js').match(/function restoreReportPlace\(\)\{[^\n]*/)[0], read('app/google-tasks.js').match(/function taskPlace[^\n]*/)[0]]) assert.doesNotMatch(fn, /localStorage|sessionStorage/);
});

test('③ 잘림: 노트 큰 창·입력칸의 [폴더 ▾]는 줄어들지 않고 8글자까지 다 보인다, 안내 글은 짧게', async () => {
  assert.match(read('app/ed-window.css'), /button\[data-edw-folder\] \{ position:relative; flex:0 0 auto;/);
  assert.match(read('app/basket.css'), /button\.home-quick-folder \{ position:relative; flex:0 0 auto;/);
  const nw = read('app/note-window.js');
  assert.match(nw, /placeholder = '제목\(비우면 첫 줄\)'/);
  const short = new Function(`${nw.match(/const shortFolder = [^\n]+/)[0].replace('export ', '')}; return shortFolder;`)();
  assert.equal(short('회의'), '회의');
  assert.equal(short('여덟글자폴더이름'), '여덟글자폴더이름');
  assert.equal(short('아홉글자인폴더이름'), '아홉글자인폴더이…');
  assert.match(read('app/home-quick.js'), /\.length>8\?\[\.\.\.label\]\.slice\(0,8\)\.join\(''\)\+'…':label\)\+' ▾'/);
});

test('① ▾: 고를 거리를 여는 버튼은 이름 뒤 작은 ▾(읽어 주는 이름은 그대로), [화면 색]은 PC에서 누른 자리 아래', () => {
  const css = read('app/ui-standard.css');
  const rule = css.match(/:is\([^{]*lu-select-act\[aria-haspopup\][^{]*\)::before\{[^}]*\}/)?.[0] || '';
  for (const sel of ['data-quick-day="week"', 'data-manual-task-day="week"', 'data-task-due-quick="week"', 'data-gt-due-quick="week"']) assert.ok(rule.includes(sel), sel);
  assert.match(rule, /content:"▾" \/ ""/);
  assert.match(read('app/topbar-actions.css'), /\.account-action\[data-theme-open\]::before\{content:"▾";content:"▾" \/ ""/);
  const top = read('app/topbar-actions.js');
  assert.match(top, /import \{isWide,placeAnchored,followAnchor,clearAnchored\} from '\.\/anchored-popup\.js'/);
  assert.match(top, /anchorTheme\(focusTrigger\);/);
  assert.match(top, /function closeTheme\(\)\{[\s\S]*?unanchorTheme\(\);/);
});

test('⑥ 사업 보고: 사업영역·할 일에 있음 줄을 누르면 그 자리로, 위쪽 줄 중간 단계', () => {
  const area = read('app/business-area-fields.js');
  assert.match(area, /data-biz-area-open/);
  assert.match(area, /data-biz-plan-open/);
  assert.match(area, /KPTUAreaWindow\?\.open\?\.\(\{id:shown\.id/);
  assert.match(area, /KPTUGoogleTasks\?\.openEditor\?\.\(task\)/);
  const top = read('app/topbar-actions.js');
  assert.match(top, /kptu:where-step/);
  assert.match(top, /for\(const step of item\.trail\)/);
  assert.match(read('app/team.js'), /trail:m\?\[\{name:reportChip===ALL_KINDS\?'전체':reportKindLabel\(reportChip\),step:'chip:'\+reportChip\}\]:\[\]/);
  assert.match(read('app/project-system-v3.js'), /trail:id\?ancestors\(current\)\.map\(up=>\(\{name:up\.name\|\|'이름 없음',step:'project:'\+up\.id\}\)\):\[\]/);
});

test('⑤ 좌우 밀기 탭 이동은 되살리지 않는다(UI-밀기탭이동삭제 결정 유지)', () => {
  assert.throws(() => read('app/mobile-swipe-navigation.js'));
  for (const f of ['app/loader-v2.js', 'app/view-loader.js']) assert.doesNotMatch(read(f), /mobile-swipe-navigation/);
});
