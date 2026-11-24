// NOTE-게시 ②(docs/design/note-publish.md): 노트 게시 상태 계산·메뉴 칸·제목 사본·열린 링크 고르기, 그리고 화면 코드의 경계(링크 값 저장 안 함 등).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pubStates, pageTitleFor, liveLink, pubMenu, PUB_LABELS, PUB_ON, PUB_OFF, PUB_NONE} from '../app/note-publish-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('짝 + 페이지 상태 → 게시 중 / 멈춤 / 없음(휴지통 페이지는 RLS가 숨겨 없음)', () => {
  const s = pubStates(
    [{page_id:'p1', note_id:'n1'}, {page_id:'p2', note_id:'n2'}, {page_id:'p3', note_id:'n3'}, {page_id:'p4', note_id:'n4'}, {page_id:'p5', note_id:null}],
    [{id:'p1', status:'published'}, {id:'p2', status:'draft'}, {id:'p3', status:'archived'}]);
  assert.deepEqual(s.get('n1'), {pageId:'p1', state:PUB_ON});
  assert.equal(s.get('n2').state, PUB_OFF);
  assert.equal(s.get('n3').state, PUB_OFF);
  assert.equal(s.get('n4').state, PUB_NONE);
  assert.equal(s.size, 4); // 노트를 완전히 지운 짝(note_id null)은 뺀다
  assert.equal(pubStates(null, null).size, 0);
});

test('제목 사본: 1~200자, 제어 글자 없음, 비면 "노트"', () => {
  assert.equal(pageTitleFor({title:'  회의 정리 '}), '회의 정리');
  assert.equal(pageTitleFor({title:''}), '노트');
  assert.equal(pageTitleFor({title:null}), '노트');
  assert.equal(pageTitleFor({title:'가\n나\t다'}), '가 나 다');
  assert.equal([...pageTitleFor({title:'가'.repeat(300)})].length, 200);
});

test('열린 링크: 꺼지거나 기한이 지난 것은 빼고 가장 먼저 만든 것', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const links = [
    {id:'a', created_at:'2026-11-03', disabled_at:'2026-11-04'},
    {id:'b', created_at:'2026-11-02', expires_at:'2026-11-01T00:00:00Z'},
    {id:'c', created_at:'2026-11-05', expires_at:null},
    {id:'d', created_at:'2026-11-04', expires_at:'2026-12-01T00:00:00Z'},
  ];
  assert.equal(liveLink(links, now).id, 'd');
  assert.equal(liveLink([links[0], links[1]], now), null);
  assert.equal(liveLink(null, now), null);
});

test('메뉴 칸: 게시 전 [공유 링크 만들기], 게시 중 [링크 복사]·[게시 멈춤], 잠근 폴더는 게시를 새로 열지 않음', () => {
  assert.deepEqual(pubMenu(PUB_NONE), ['make']);
  assert.deepEqual(pubMenu(PUB_OFF), ['make']);
  assert.deepEqual(pubMenu(PUB_ON), ['copy', 'stop']);
  assert.deepEqual(pubMenu(PUB_NONE, {locked:true}), []);
  assert.deepEqual(pubMenu(PUB_ON, {locked:true}), ['stop']);
  assert.deepEqual(PUB_LABELS, {make:'공유 링크 만들기', copy:'링크 복사', stop:'게시 멈춤'});
});

test('화면 코드 경계: 링크 값은 들고 있지 않고, 서버 쓰기는 owner REST 세 표뿐(새 RPC·기기 저장 없음)', () => {
  const src = read('app/note-publish.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|console\./);
  assert.doesNotMatch(src, /\/rest\/v1\/rpc\//);
  const tables = [...src.matchAll(/\/rest\/v1\/([a-z_]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ['app_note_share_pages', 'app_share_page_links', 'app_share_pages']);
  // token은 상태(states)에 넣지 않는다: states.set 값에는 pageId·state만.
  for (const m of src.matchAll(/states\.set\([^;]*\)/g)) assert.doesNotMatch(m[0], /token/);
  // 링크 목록은 값 없이 읽는다(값은 고른 하나만 id로).
  assert.match(src, /select=id,expires_at,disabled_at,created_at/);
});

test('공유 페이지 목록·보관함은 노트 짝이 있는 줄을 뺀다', () => {
  const src = read('app/share-pages.js');
  assert.match(src, /app_note_share_pages\?workspace_id=eq\.\$\{ws\}&select=page_id/);
  assert.match(src, /pages = rows\.filter\(p => !noteOwned\.has\(p\.id\)\); box = kept\.filter\(p => !noteOwned\.has\(p\.id\)\)/);
});

test('노트 화면: 메뉴 칸은 잠근 폴더 판정을 거치고, 받는 화면은 사진 자리 안내 한 줄', () => {
  const notes = read('app/basket-notes.js');
  assert.match(notes, /pubMenu\(notePub\.stateOf\(note\.id\), \{locked:pinLock\.noteInLockedFolder\(note\)\}\)/);
  assert.match(notes, /if \(kind !== 'stop' && pinLock\.noteInLockedFolder\(note\)\) return;/);
  assert.match(read('share/share.js'), /사진은 이 링크에서 보이지 않아요\./);
});
