import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// S62-16 연결 안내 공용 부품: 처음 = '연결', 권한 빠짐 = '다시 연결', 표기 '구글', 글 한 줄 → 아래 버튼.
const {CONNECT_TEXT, connectText, connectNoteHtml, connectNoteFor} = await import('../app/connect-note.mjs');

test('처음은 연결, 권한 빠짐만 다시 연결', () => {
  for (const [service, t] of Object.entries(CONNECT_TEXT)) {
    assert.doesNotMatch(t.none.button, /다시/, service);
    assert.match(t.none.button, /연결$/);
    if (t.reconnect) assert.match(t.reconnect.button, /다시 연결$/);
    for (const x of Object.values(t)) {
      assert.doesNotMatch(x.line + x.button, /Google|Drive|OneDrive|Tasks|OAuth|권한을 다시|합니다|습니다/);
      assert.match(x.line, /요\.$/);
    }
  }
  assert.equal(connectText('tasks').button, '구글 할 일 연결');
  assert.equal(connectText('tasks', 'reconnect').button, '구글 할 일 다시 연결');
  assert.equal(connectText('calendar', 'reconnect'), null);
  assert.equal(connectText('nope'), null);
});

test('모양: 안내 줄(p) 다음에 버튼, 속성은 data-*만, 글은 이스케이프', () => {
  const h = connectNoteHtml({line:'<b>x</b>', button:'연결', attrs:{'data-a':'"1"', onclick:'evil()'}});
  assert.match(h, /^<div class="connect-note" data-connect-note><p class="connect-note-line">&lt;b&gt;x&lt;\/b&gt;<\/p><button type="button" class="secondary connect-note-btn" data-a="&quot;1&quot;">연결<\/button><\/div>$/);
  assert.doesNotMatch(h, /onclick/);
  assert.doesNotMatch(connectNoteHtml({line:'a'}), /<button/);
  const f = connectNoteFor('gdrive', 'reconnect', {attrs:{'data-x':''}});
  assert.match(f, /data-connect-service="gdrive" data-connect-mode="reconnect"/);
  assert.match(f, />구글 드라이브 다시 연결</);
  assert.equal(connectNoteFor('calendar', 'reconnect'), '');
});

test('CSS: 늘 두 줄(세로), 버튼은 왼쪽', () => {
  const css = readFileSync(new URL('../app/base-ui.css', import.meta.url), 'utf8');
  assert.match(css, /\.connect-note\{display:flex;flex-direction:column;align-items:flex-start/);
});

test('할 일 화면은 공용 부품으로 그리고 옛 "권한 다시 연결" 고정 글이 없다', () => {
  const src = readFileSync(new URL('../app/google-tasks.js', import.meta.url), 'utf8');
  assert.match(src, /connectNoteFor\('tasks',mode==='none'\?'none':'reconnect'/);
  assert.doesNotMatch(src, /Google 할 일 권한 다시 연결|Google 권한 다시 연결|함께 관리할 수 있습니다/);
});

test('버튼 여럿: 아래 줄에 나란히(한 줄 묶음), 각자 속성', () => {
  const h = connectNoteHtml({line:'연결된 클라우드가 없어요.', buttons:[{label:'원드라이브 연결', attrs:{'data-c':'od'}}, {label:'구글 드라이브 연결', attrs:{'data-c':'gd'}}]});
  assert.match(h, /<\/p><span class="connect-note-btns"><button[^>]*data-c="od">원드라이브 연결<\/button><button[^>]*data-c="gd">구글 드라이브 연결<\/button><\/span><\/div>$/);
});
