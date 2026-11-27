import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// RULE-한번에그리기(AGENTS.md 4절, docs/design/screen-open-once-audit.md): 화면 불러오기 도구(view-loader.js)가 화면 모듈의
// '첫 그림 약속'을 기다린 뒤에야 라우터가 화면을 보인다. 이 시험은 그 길이 끊기지 않게 지킨다(브라우저 시험은 tests/app-e2e/screen-open-once.spec.mjs).
const read = f => readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');
const loader = read('view-loader.js');

test('view-loader: screen()은 첫 그림 약속을 시간 상한과 함께 기다린다', () => {
  assert.match(loader, /const FIRST_PAINT_MS=\d+;/);
  assert.match(loader, /async function screen\(path,readyName\)\{[\s\S]*?await import\(path\);[\s\S]*?Promise\.race\(\[[\s\S]*?FIRST_PAINT_MS/);
});

for (const [view, file, ready] of [['files', './files.js', '__KPTU_FILES_READY__'], ['brief', './brief-room.js', '__KPTU_BRIEF_READY__'], ['reading', './reading.js', '__KPTU_READING_READY__']]) {
  test(`${view}: 화면 불러오기가 ${ready}를 기다리고, 모듈이 그 약속을 둔다`, () => {
    assert.ok(loader.includes(`await screen('${file}','${ready}')`), `${view} loader가 screen()을 쓰지 않음`);
    assert.ok(read(file.slice(2)).includes(`window.${ready} =`) || read(file.slice(2)).includes(`window.${ready}=`), `${file}가 ${ready}를 두지 않음`);
  });
}

test('files: 연결 상태를 받기 전에 기본 모양을 먼저 그리지 않는다', () => {
  const src = read('files.js'), enter = src.slice(src.indexOf('async function enter('), src.indexOf('window.addEventListener(\'kptu:view-changed\''));
  assert.doesNotMatch(enter, /if \(!state\.status \|\| force\) \{ paint\(\);/);
  assert.match(enter, /else if \(!state\.status\) await prime\(\);/);
});

test('brief·reading: 처음 보일 때 첫 읽기를 다시 하지 않는다(같은 약속을 씀)', () => {
  assert.match(read('brief-room.js'), /if\(!firstShown\)\{firstShown=true;[^}]*void firstDraw\.then/);
  assert.match(read('reading.js'), /if \(!firstShown\) \{ firstShown = true;[^}]*firstDraw\.then/);
});

test('사업 관리: 사업영역 나무·회의명 정리·보고 연결을 받은 뒤 첫 그림을 한 번 그린다', () => {
  const team = read('team.js'), flight = team.slice(team.indexOf("}else if(view==='meetings'){"), team.indexOf('teamViewLoaded.add(view);'));
  assert.match(flight, /fetchAreaTree\(\)/);
  assert.match(flight, /await Promise\.all\(\[loadReportLinks\(\),readNameSorts/);
  // 첫 그림 뒤 보고 연결이 와서 다시 그리던 길은 없다.
  assert.doesNotMatch(flight, /void loadReportLinks\(\)\.then/);
  const at = flight.indexOf('renderMeetings();'), wait = flight.lastIndexOf('await Promise.all(');
  assert.ok(wait >= 0 && at > wait, '첫 그림이 기다림보다 앞에 있음');
});

test('걸러보기 칩: 처음 보일 때 다음 프레임으로 미루지 않고 바로 잰다', () => {
  const chip = read('report-filter-chip.js');
  assert.match(chip, /new ResizeObserver\(\(\[entry\]\)=>\{[^}]*layout\(\)\}\)\.observe\(top\)/);
  assert.doesNotMatch(chip, /requestAnimationFrame\(\(\)=>\{frame=0;layout\(\)\}\)/);
});
