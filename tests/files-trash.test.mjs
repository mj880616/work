import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// S69-62 [파일] 휴지통 보기(명진 11/24 18:17): 구글 드라이브는 휴지통 목록·되살리기·영구 삭제(FILES-휴지통영구삭제, 확인 뒤 서버 purge), 원드라이브는 웹 휴지통 열기. 비우기 없음.
const DEVICE_STORES = new RegExp([['local', 'Storage'], ['session', 'Storage'], ['indexed', 'DB']].map(p => p.join('')).join('|'));
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('휴지통 창: 서버 cloud-files의 trash_list(읽기)·untrash·purge(confirm:true, 사람이 누른 것만)만 부른다, 영구 삭제는 확인 뒤, 기기 저장 없음', () => {
  const src = read('app/files-trash.js');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.deepEqual([...new Set([...code.matchAll(/call\('([\w-]+)'/g)].map(m => m[1]))].sort(), ['purge', 'trash_list', 'untrash']);
  assert.match(code, /call\('untrash', \{source: 'gd', ids, confirm: true\}\)/);
  assert.match(code, /call\('purge', \{source: 'gd', ids: part, confirm: true\}\)/);
  assert.doesNotMatch(code, /canPurge: false/, '영구 삭제 그림 단추·막대 단추를 그린다');
  assert.equal((code.match(/canPurge: true/g) || []).length, 2, '줄 그림 단추 + 고르기 막대');
  // 확인 창을 먼저: askConfirm이 purge 호출보다 앞, 확인을 거절하면 돌아간다.
  const body = code.slice(code.indexOf('async function purge('), code.indexOf('function onClick('));
  assert.ok(body.indexOf('askConfirm(') > 0 && body.indexOf('askConfirm(') < body.indexOf("call('purge'"), '확인 뒤에만 서버를 부른다');
  assert.match(body, /ok: '영구 삭제', danger: true/);
  assert.match(code, /PURGE_NOTE = '삭제하면 되돌릴 수 없어요\.'/);
  assert.match(code, /PURGE_CHUNK = 100/);
  assert.match(code, /from '\.\/trash-row\.js'/, '줄·고르기는 공용 휴지통 줄 부품(trash-row.js)');
  assert.doesNotMatch(code, /emptyTrash|permanent|method: 'DELETE'/i);
  assert.doesNotMatch(code, DEVICE_STORES); // 기기 저장 낱말은 감사(browser-storage-audit)가 세지 않게 조각으로 만든다(files-model.test.mjs와 같음)
  // 원드라이브 웹 휴지통은 새 창, 원드라이브 주소일 때만.
  assert.match(code, /target="_blank" rel="noopener noreferrer"/);
  assert.match(code, /d\.web\.startsWith\('https:\/\/onedrive\.live\.com\/'\)/);
});

test('[파일] 나무: 구글 드라이브·원드라이브 상자 맨 아래 회색 휴지통 줄(공용 ftTrashRowHtml), 누르면 휴지통 창(필요할 때만 불러옴)', () => {
  const files = read('app/files.js');
  assert.match(files, /const trashRowHtml = source => \(SOURCES\.includes\(source\) \? ftTrashRowHtml\(\{attrs: \{'data-fx-cloud-trash': source/);
  assert.equal((files.match(/\+ \(shut \|\| loading \? '' : trashRowHtml\(source\)\)/g) || []).length, 2, 'PC 나무·폰 나무 둘 다');
  assert.match(files, /mod = await import\('\.\/files-trash\.js'\)/);
  assert.match(files, /if \(b\.matches\('\[data-fx-cloud-trash\]'\)\) \{ void openTrash\(b\.dataset\.fxCloudTrash, b\); return; \}/);
});

test('서버: 구글 휴지통 목록은 내 파일·직접 지운 것만, 되살리기는 휴지통에 있는 내 파일만(PATCH trashed:false), 원드라이브는 목록 없음', () => {
  const h = read('supabase/functions/cloud-files/handler.ts');
  assert.match(h, /u\.searchParams\.set\("q", "'me' in owners and trashed=true"\)/);
  assert.match(h, /if \(f\.ownedByMe !== true \|\| f\.trashed !== true\) throw new Fail\(404, "not_in_trash"\)/);
  assert.match(h, /"gd_untrash", token, `\$\{DRIVE\}\/files\/\$\{encodeURIComponent\(id\)\}\?fields=\$\{GD_FIELDS\}`, "PATCH", \{ trashed: false \}\)/);
  assert.match(h, /async untrash\(\{ workspaceId: ws, body: b \}\) \{\n\s*mustConfirm\(b\);/);
  assert.match(h, /export const OD_TRASH_URL = "https:\/\/onedrive\.live\.com\/\?v=recyclebin";/);
});

test('서버: 영구 삭제(purge)는 구글만, confirm:true, 100개까지, 줄마다 휴지통·내 것·내 드라이브·canDelete 확인 뒤 DELETE', () => {
  const h = read('supabase/functions/cloud-files/handler.ts');
  assert.match(h, /async purge\(\{ workspaceId: ws, body: b \}\) \{\n\s*mustConfirm\(b\);\n\s*if \(b\.source !== "gd"\) throw new Fail\(400, "source_invalid"\);/);
  assert.match(h, /export const PURGE_MAX = 100;/);
  assert.match(h, /PURGE_PICK_FIELDS = "id,trashed,ownedByMe,driveId,capabilities\(canDelete\)"/);
});
