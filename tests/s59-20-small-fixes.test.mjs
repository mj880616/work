import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {plainText, rowHtml} from '../app/notice-box.mjs';
import {ROW_MENU_ICON} from '../app/row-menu.js';
import {eventMenuItems, DAY_MENU_ITEMS, PLAN_ICON} from '../app/calendar-row-menu.mjs';
import {planRowMenuItems} from '../app/report-calendar-plan.mjs';

// S59-20 OPS-작은손보기: ① 보고 상세 빈 칸에 '없음'을 따로 안 붙인다 ② 잊지 말기 글의 ** 표시를 없앤다 ③ 일정 메뉴의 빈 네모(그림 없는 칸)를 없앤다.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const STATUS_TODO = 'todo';

test('② 잊지 말기 글: ** 표시는 걷고 글은 그대로, 없는 값은 빈 글', () => {
  assert.equal(plainText('**자료** 정리'), '자료 정리');
  assert.equal(plainText('앞 **굵게** 뒤 **또** 끝'), '앞 굵게 뒤 또 끝');
  assert.equal(plainText('별표 없는 글'), '별표 없는 글');
  assert.equal(plainText(null), '');
  assert.equal(plainText(undefined), '');
  assert.equal(plainText(12), '12');
});

test('② 공용 줄(notice-box): 글·이유 모두 ** 없이 그리고, 태그는 그대로 글자로 나온다(이스케이프 유지)', () => {
  const html = rowHtml({id: 'x1', body: '**회의** 자료 <b>확인</b>', why: '이유 **하나**', meta: '10/6', actions: []});
  assert.ok(!html.includes('**'), '별표 두 개가 줄에 남지 않는다');
  assert.ok(html.includes('회의 자료 &lt;b&gt;확인&lt;/b&gt;'));
  assert.ok(html.includes('이유 하나'));
});

test('② 업데이트 줄(내용 버튼 open.label)·업데이트 제목 함수도 ** 없이 그린다', () => {
  const html = rowHtml({id: 'u:1', body: '무시되는 글', open: {attrs: 'data-basket-row="1"', label: '지어낸 **업데이트** 제목'}, meta: '10/6', acts: []});
  assert.ok(!html.includes('**'));
  assert.ok(html.includes('>지어낸 업데이트 제목</button>'));
  // label이 없으면 예전처럼 body를 쓴다.
  assert.ok(rowHtml({id: 'u:2', body: '본문 **글**', open: {attrs: 'data-x'}, acts: []}).includes('>본문 글</button>'));
  assert.match(read('app/basket.js'), /return plainText\(lines\[0\]\|\|''\)\|\|fileTitle/);
  assert.match(read('app/basket-manual-link.js'), /firstLine\(plainText\(n\.raw_text\)\)/);
});

test('② 잊지 말기·후보 줄이 쓰는 모든 글 길은 plainText를 거친다(할 일 창 미리 채움 제목 포함)', () => {
  const forget = read('app/forget-list.js'), inbox = read('app/inbox-todos.js');
  assert.match(forget, /import \{[^}]*\bplainText\b[^}]*\} from '\.\/notice-box\.mjs'/);
  assert.match(inbox, /import \{plainText\} from '\.\/notice-box\.mjs'/);
  // 새 마크다운 해석기를 따로 만들지 않고 이미 있는 telegramInline 하나를 쓴다.
  assert.match(read('app/notice-box.mjs'), /import \{telegramInline\} from '\.\/md-telegram\.mjs'/);
  for (const src of [forget, inbox]) {
    for (const m of src.matchAll(/(title|summary): *([^,}\n]*c\??\.summary[^,}\n]*)/g)) {
      assert.match(m[2], /plainText\(/, `${m[0]} 은 ** 를 걷고 쓴다`);
    }
  }
});

test('③ 달력 일정 메뉴·사업 보고 달력 ⋯ 메뉴: 모든 항목에 그림이 있다(빈 네모 없음)', () => {
  const iconOf = it => it.icon || ROW_MENU_ICON[it.id];
  const menus = {
    '일정(쓰기)': eventMenuItems(true, {on: true}),
    '일정(읽기)': eventMenuItems(false, {on: false}),
    '날짜 칸': [...DAY_MENU_ITEMS],
    '보고할 일정 ⋯(켠 줄)': planRowMenuItems({status: STATUS_TODO}),
    '보고할 일정 ⋯(보고할까요?)': planRowMenuItems({status: 'ask'})
  };
  for (const [name, items] of Object.entries(menus)) {
    assert.ok(items.length > 0, name);
    for (const it of items) assert.ok(iconOf(it), `${name}의 [${it.label}]에 그림이 있다`);
  }
});

test('③ 보고할 일정 그림은 속이 빈 네모가 아니라 깃발 한 가지를 쓴다', () => {
  assert.notEqual(PLAN_ICON, 'M3.5 3.5h9v9h-9z');
  assert.equal(eventMenuItems(true, {on: false}).find(it => it.id === 'plan').icon, PLAN_ICON);
  assert.equal(planRowMenuItems({status: STATUS_TODO}).find(it => it.id === 'off').icon, PLAN_ICON);
  assert.ok(!read('app/report-calendar-plan.mjs').includes('BOX_ICON'), '같은 뜻의 그림을 두 곳에 따로 두지 않는다');
});

test('③ 왼쪽 메뉴 우클릭 [숨기기]: 그림 길이 있고, 그 메뉴의 항목(숨기기·메뉴 수정)이 모두 그림을 가진다', () => {
  assert.ok(ROW_MENU_ICON.hide, '[숨기기] 그림');
  assert.ok(ROW_MENU_ICON.edit, '[메뉴 수정] 그림');
  assert.match(read('app/topbar-actions.js'), /\{id:'hide',label:'숨기기'\}/);
});

test('① 보고 상세: 후속 할 일·자료가 없으면 칸 제목만 두고 따로 없음 글을 안 붙인다(사진 칸과 같은 규칙)', () => {
  const src = read('app/meeting-round-detail.js');
  assert.ok(!/\bemptyHtml\b/.test(src), '보고 상세는 emptyHtml(없음)을 더 쓰지 않는다');
  assert.ok(!/data-wait-empty/.test(src));
  // 챙길 것 후보 칸(meeting-todo-candidates.js)은 이미 조용한 빈 칸이다.
  assert.match(read('app/meeting-todo-candidates.js'), /quietEmpty: *true/);
});
