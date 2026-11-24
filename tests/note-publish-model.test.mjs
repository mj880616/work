// NOTE-게시 ②(docs/design/note-publish.md): 노트 게시 상태 계산·메뉴 칸·제목 사본·열린 링크 고르기, 그리고 화면 코드의 경계(링크 값 저장 안 함 등).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pubStates, pageTitleFor, liveLink, pubMenu, PUB_LABELS, PUB_ON, PUB_OFF, PUB_NONE, photoKey, mirrorBlocks, readMirror, notePhotoSrcs, MIRROR_MAX} from '../app/note-publish-model.mjs';
import {noteMirror, photoKey as serverKey} from '../supabase/functions/share-page-read/handler.ts';
import {usedPhotoIds} from '../supabase/functions/share-page-media/handler.ts';

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
  assert.doesNotMatch(src, /console\./); // 기기 저장 금지는 CI audit(저장소 전체 검사)가 본다
  assert.doesNotMatch(src, /\/rest\/v1\/rpc\//);
  const tables = [...src.matchAll(/\/rest\/v1\/([a-z_]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ['app_note_share_pages', 'app_share_page_links', 'app_share_pages']);
  // token은 상태(states)에 넣지 않는다: states.set 값에는 pageId·state만.
  for (const m of src.matchAll(/states\.set\([^;]*\)/g)) assert.doesNotMatch(m[0], /token/);
  // 링크 목록은 값 없이 읽는다(값은 고른 하나만 id로).
  assert.match(src, /select=id,expires_at,disabled_at,created_at/);
});

const PAGE = '40000000-0000-4000-8000-000000000001';
const SID = n => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('NOTE-게시 ③ 사진 거울: 지문은 화면·서버가 같은 셈이고 Drive 파일 번호를 담지 않는다', async () => {
  const k = await photoKey(PAGE, 'drive:ABC_123');
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(k, await serverKey(PAGE, 'drive:ABC_123'));
  assert.notEqual(k, await photoKey('40000000-0000-4000-8000-000000000002', 'drive:ABC_123'), '페이지마다 다른 지문');
  const blocks = mirrorBlocks([{key:k, id:SID(1)}]);
  assert.doesNotMatch(JSON.stringify(blocks), /ABC_123|drive:/);
  // 공유 페이지 블록 검사(doc 블록 바깥 모양)·서버 거울 읽기·사진 정리(prune)가 모두 같은 줄로 읽는다.
  assert.deepEqual(Object.keys(blocks[0]).sort(), ['doc', 'type']);
  assert.deepEqual(Object.keys(blocks[0].doc).sort(), ['doc', 'v']);
  assert.deepEqual([...readMirror(blocks)], [[k, SID(1)]]);
  assert.deepEqual([...noteMirror(blocks)], [[k, SID(1)]]);
  assert.deepEqual([...usedPhotoIds(blocks)], [SID(1)], '정리는 거울의 사진을 쓰는 사진으로 본다');
  assert.deepEqual(mirrorBlocks([]), []);
  assert.deepEqual([...noteMirror([])], []);
  // 모양이 틀린 줄은 빼거나(화면) 거울로 보지 않는다(서버).
  assert.deepEqual(mirrorBlocks([{key:'x', id:SID(1)}, {key:k, id:'not-a-uuid'}]), []);
  assert.equal(noteMirror([{type:'summary', text:'옛 블록'}]), null);
  assert.equal(noteMirror([{type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[{type:'paragraph'}]}}}]), null, '글이 든 옛 페이지는 거울이 아니다');
  assert.equal(readMirror([{type:'summary'}]).size, 0);
  assert.equal(mirrorBlocks(Array.from({length:30}, (_, i) => ({key:k, id:SID(i + 1)})))[0].doc.doc.content.length, MIRROR_MAX);
});

test('NOTE-게시 ③ 올릴 사진: 글 안 사진 칸 중 이 노트 첨부만(파일 칸·다른 노트 파일·겹친 것 빼고 차례대로)', () => {
  const doc = {v:'ed1', doc:{type:'doc', content:[
    {type:'image', attrs:{src:'drive:own1'}},
    {type:'photo_row', content:[{type:'image', attrs:{src:'drive:own2'}}, {type:'image', attrs:{src:'drive:own1'}}]},
    {type:'image', attrs:{src:'drive:other'}},
    {type:'file', attrs:{src:'drive:own3', name:'첨부.pdf'}},
    {type:'image', attrs:{src:'share:' + SID(1)}},
  ]}};
  const note = {doc, attachments:[{drive_file_id:'own1'}, {drive_file_id:'own2'}, {drive_file_id:'own3'}]};
  assert.deepEqual(notePhotoSrcs(note), ['drive:own1', 'drive:own2']);
  assert.deepEqual(notePhotoSrcs({doc:null, attachments:[{drive_file_id:'own1'}]}), []);
  assert.deepEqual(notePhotoSrcs({doc, attachments:[]}), []);
});

test('NOTE-게시 ③ 화면 코드: 사진은 주인 로그인으로만(basket-files 사진 → share-page-media), 게시 멈춤은 거울을 비우고 정리', () => {
  const src = read('app/note-publish.js').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /import \{createSharePhotos, shareIdOf\} from '\.\/share-photos\.js';/);
  assert.match(src, /diaryPhotoUrl\(note\.id, src\.slice\(6\), 'large', \{rt\}\)/);
  assert.match(src, /setStatus\(cur\.pageId, 'draft', null, \{blocks:\[\]\}\)/);
  assert.match(src, /prune\(\(\) => \[\]\)/);
  assert.doesNotMatch(src, /functions\/v1\//, '서버 함수는 기존 모듈(share-photos·diary-data)로만 부른다');
  const photos = read('app/share-photos.js');
  assert.match(photos, /shrink\(file, \{edge: SHARE_PHOTO_EDGE, quality: 0\.86, redraw: true\}\)/, '다시 그려 위치 정보가 빠진 JPEG');
  const notes = read('app/basket-notes.js');
  assert.match(notes, /pubPhotos\(note\);/);
  assert.match(notes, /renderList\(\); paintMeta\(\); pubPhotos\(note\);/);
});

test('노트 화면: 메뉴 칸은 잠근 폴더 판정을 거치고, 받는 화면은 못 올린 사진 자리에 안내 한 줄', () => {
  const notes = read('app/basket-notes.js');
  assert.match(notes, /pubMenu\(notePub\.stateOf\(note\.id\), \{locked:pinLock\.noteInLockedFolder\(note\)\}\)/);
  assert.match(notes, /if \(kind !== 'stop' && pinLock\.noteInLockedFolder\(note\)\) return;/);
  assert.match(read('share/share.js'), /사진은 이 링크에서 보이지 않아요\./);
});
