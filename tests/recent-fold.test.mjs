import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ftBoxHtml, ftCaretHtml} from '../app/folder-tree-ui.mjs';
import {validValue, RECENT_FOLD_SCREENS} from '../app/view-prefs.js';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('S51-22 recent_folded 화면 값 검사 = DB 검사(files·notes·library, 4개까지)', () => {
  assert.deepEqual([...RECENT_FOLD_SCREENS], ['files', 'notes', 'library']);
  for (const v of [[], ['files'], ['notes', 'library'], ['files', 'notes', 'library']]) assert.equal(validValue('recent_folded', v), true, JSON.stringify(v));
  for (const v of ['files', null, {files: true}, ['photos'], ['FILES'], [1], ['files', 'notes', 'library', 'files', 'notes']]) assert.equal(validValue('recent_folded', v), false, JSON.stringify(v));
  const sql = read('supabase/migrations/20261106233000_profile_view_prefs_recent_folded.sql');
  assert.match(sql, /jsonb_array_length\(view_prefs -> 'recent_folded'\) <= 4/);
  assert.match(sql, /@ == "files" \|\| @ == "notes" \|\| @ == "library"/);
});

test('S51-22·S51-33 상자 머리 줄: 이름 바로 옆 공용 꺾쇠(⌃⌄), 더보기는 따로 오른쪽, 접으면 머리 줄 한 줄만(더보기도 숨김)', () => {
  const open = ftBoxHtml({head: '최근', body: '<p>줄</p>', tail: '<b>더보기</b>', collapsible: true, caret: true, open: true, toggleAttrs: {'data-x': ''}});
  assert.match(open, /aria-expanded="true"/);
  // 꺾쇠는 접기 단추 안 '최근' 바로 뒤, '더보기'는 단추 밖(오른쪽).
  assert.match(open, /aria-expanded="true">최근<i class="kptu-chev is-open ft-box-caret" aria-hidden="true"><\/i><\/button><b>더보기<\/b>/);
  assert.match(open, /<p>줄<\/p>/);
  assert.doesNotMatch(open, /[▴▾▸]/);
  const shut = ftBoxHtml({head: '최근', body: '<p>줄</p>', tail: '<b>더보기</b>', collapsible: true, caret: true, open: false});
  assert.match(shut, /aria-expanded="false">최근<i class="kptu-chev ft-box-caret" aria-hidden="true"><\/i><\/button>/);
  assert.doesNotMatch(shut, /더보기|<p>|접힘|[▴▾▸]/);
  assert.equal(ftCaretHtml(false), '<i class="kptu-chev ft-box-caret" aria-hidden="true"></i>');
  // 저장소 상자(caret 없음)는 그대로 '접힘' 글자.
  assert.match(ftBoxHtml({head: '원드라이브', collapsible: true, open: false}), /접힘/);
});

test('S51-22 접은 상태는 서버 칸 하나(recent-fold.js, view_prefs)로만 — 세 화면이 같은 부품', () => {
  const src = read('app/recent-fold.js');
  assert.match(src, /viewPrefs\.set\('recent_folded'/);
  for (const [p, name] of [['app/files.js', 'files'], ['app/basket-notes.js', 'notes'], ['app/library-upload.js', 'library']]) {
    const s = read(p);
    assert.match(s, /from '\.\/recent-fold\.js'/, p);
    assert.ok(s.includes(`recentFolded('${name}')`) && s.includes(`toggleRecentFolded('${name}')`), p);
  }
});
