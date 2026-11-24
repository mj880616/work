// S69-20 ①②: 자료실 저장 위치 한 줄(서버 판단 supabase/functions/workspace-drive/drive-place.mjs)과 새 사용자 맨 위 폴더 이름. 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drivePlace, folderUrl, metaUrl, parsePlaceRequest } from '../supabase/functions/workspace-drive/drive-place.mjs';
import { ROOT_FOLDER_NAME } from '../supabase/functions/_shared/brand-folders.mjs';

const LIB = 'libraryFolder0001', ROOT = 'rootFolder000001', MY = 'myDriveRoot00001';
const folder = (id, name, parents) => ({ id, name, parents, trashed: false, mimeType: 'application/vnd.google-apps.folder' });

test('요청 모양: GET ?action=drive-place 하나만(폴더 id 등 다른 값은 받지 않음)', () => {
  const u = q => new URL('https://x.example/functions/v1/workspace-drive' + q);
  assert.equal(parsePlaceRequest(u('?action=drive-place')), true);
  assert.equal(parsePlaceRequest(u('?action=drive-place&folder_id=x')), false);
  assert.equal(parsePlaceRequest(u('?action=download')), false);
  assert.equal(parsePlaceRequest(u('')), false);
});

test('드라이브의 지금 이름으로 경로를 모으고, 내 드라이브 자체(부모 없음)는 넣지 않는다', async () => {
  const asked = [];
  const metas = { [LIB]: folder(LIB, '자료실', [ROOT]), [ROOT]: folder(ROOT, '웹2', [MY]), [MY]: folder(MY, '내 드라이브', undefined) };
  const place = await drivePlace(LIB, async id => { asked.push(id); return metas[id] ?? null; });
  assert.deepEqual(place, { folder_id: LIB, url: folderUrl(LIB), path: ['웹2', '자료실'] });
  assert.deepEqual(asked, [LIB, ROOT, MY]);
  assert.equal(place.url, 'https://drive.google.com/drive/folders/libraryFolder0001');
});

test('권한 밖 부모(읽기 실패)에서 멈추고, 폴더가 없거나 휴지통이면 null', async () => {
  const onlyLib = await drivePlace(LIB, async id => id === LIB ? folder(LIB, '자료실', [ROOT]) : null);
  assert.deepEqual(onlyLib.path, ['자료실']);
  const thrown = await drivePlace(LIB, async id => { if (id === LIB) return folder(LIB, '자료실', [ROOT]); throw new Error('net'); });
  assert.deepEqual(thrown.path, ['자료실']);
  assert.equal(await drivePlace(LIB, async () => null), null);
  assert.equal(await drivePlace(LIB, async () => ({ ...folder(LIB, '자료실', [ROOT]), trashed: true })), null);
  assert.equal(await drivePlace(LIB, async () => ({ ...folder(LIB, 'a.pdf', [ROOT]), mimeType: 'application/pdf' })), null);
  assert.equal(await drivePlace(LIB, async () => folder('다른폴더id0000', '자료실', [ROOT])), null, '다른 id 답은 믿지 않음');
  assert.equal(await drivePlace('', async () => { throw new Error('부르면 안 됨'); }), null);
  assert.equal(await drivePlace('bad id/../x', async () => { throw new Error('부르면 안 됨'); }), null);
});

test('깊이 한도와 이름 정리', async () => {
  const metas = {};
  for (let i = 0; i < 10; i++) metas['f' + String(i).padStart(12, '0')] = folder('f' + String(i).padStart(12, '0'), ` 폴더${i}\u0007 `, ['f' + String(i + 1).padStart(12, '0')]);
  const place = await drivePlace('f000000000000', async id => metas[id] ?? null);
  assert.equal(place.path.length, 6);
  assert.equal(place.path.at(-1), '폴더0');
});

test('드라이브 읽기 주소는 폴더 이름·부모만 묻는다(내용 없음)', () => {
  assert.equal(metaUrl(LIB), 'https://www.googleapis.com/drive/v3/files/libraryFolder0001?fields=id,name,parents,trashed,mimeType&supportsAllDrives=true');
});

test('② 새 사용자 맨 위 폴더 이름은 WORK ON+ — 노조·팀 이름이 박힌 맨 위 폴더 이름이 남지 않음', () => {
  assert.equal(ROOT_FOLDER_NAME, 'WORK ON+');
  for (const fn of ['library-files', 'workspace-drive', 'meeting-files', 'meeting-transcribe']) {
    const src = readFileSync(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8');
    assert.ok(!src.includes('공공기관사업팀 Workspace'), fn);
    assert.ok(!/createFolder\(token, '웹2'\)|name:'웹2'/.test(src), fn);
    assert.ok(src.includes('ROOT_FOLDER_NAME'), fn);
    // 이미 있는 사람은 저장된 id로 찾고 새로 만들지 않는다(이름을 바꾸는 요청 없음).
    assert.ok(src.includes('root_folder_id'), fn);
  }
});

test('화면 한 줄(app/library-drive-line.js): 드라이브 폴더 주소만, 글자는 막아서', async () => {
  const { cleanPlace, driveLineHtml, mountLibraryDriveLine } = await import('../app/library-drive-line.js');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const url = 'https://drive.google.com/drive/folders/libraryFolder0001';
  assert.deepEqual(cleanPlace({ url, path: [' 웹2 ', '자료실', ''] }), { url, path: ['웹2', '자료실'] });
  assert.equal(cleanPlace({ url: 'https://evil.example/drive/folders/x', path: ['a'] }), null);
  assert.equal(cleanPlace({ url: 'javascript:alert(1)', path: ['a'] }), null);
  assert.equal(cleanPlace({ url, path: [] }), null);
  assert.equal(cleanPlace(null), null);
  const html = driveLineHtml({ url, path: ['<b>웹2</b>', '자료실'] }, esc);
  assert.match(html, /구글 드라이브 · &lt;b&gt;웹2&lt;\/b&gt; › 자료실/);
  assert.match(html, /href="https:\/\/drive\.google\.com\/drive\/folders\/libraryFolder0001" target="_blank" rel="noopener noreferrer"/);
  assert.equal(driveLineHtml(null, esc), '');
  // 겹친 요청은 마지막 답만 그린다.
  const box = { innerHTML: '', hidden: true };
  const answers = [];
  const api = () => new Promise(r => answers.push(r));
  const line = mountLibraryDriveLine({ api, esc, el: () => box });
  const first = line.refresh(), second = line.refresh();
  answers[1]({ ok: true, place: { url, path: ['웹2', '자료실'] } });
  await second;
  answers[0]({ ok: true, place: null });
  await first;
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /웹2 › 자료실/);
});
