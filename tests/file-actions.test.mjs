import test from 'node:test';
import assert from 'node:assert/strict';
import {clickKind, driveOpenUrl, driveDownloadUrl, canDownload, canOpenInDrive, menuItemsHtml, fileAttrs, pressFile, downloadFile, openInDrive} from '../app/file-actions.js';

// FILE-누르면동작: 파일 종류별 누르기 규칙과 두 내려받기 길.
function fakeDom() {
  const clicked = [];
  globalThis.document = {createElement: () => { const a = {click() { clicked.push({href: a.href, target: a.target, rel: a.rel}); }, remove() {}}; return a; }, body: {append() {}}};
  globalThis.location = {href: ''};
  return clicked;
}

test('clickKind: PDF·HWP·사진·그 밖', () => {
  for (const [name, mime, kind] of [['a.pdf', '', 'pdf'], ['a.PDF', 'application/octet-stream', 'pdf'], ['x', 'application/pdf', 'pdf'],
    ['a.hwp', '', 'hwp'], ['a.HWPX', 'application/zip', 'hwp'], ['a.jpg', '', 'photo'], ['b', 'image/png', 'photo'], ['c.webp', 'x', 'photo'], ['d.gif', '', 'photo'],
    ['e.heic', 'image/heic', 'download'], ['f.xlsx', '', 'download'], ['g.docx', '', 'download'], ['h.zip', '', 'download'], ['', '', 'download']])
    assert.equal(clickKind({name, mime}), kind, `${name}|${mime}`);
});

test('주소: Drive 보기·내려받기, 잘못된 번호·주소는 거절', () => {
  assert.equal(driveOpenUrl({driveUrl: 'https://drive.google.com/file/d/q/view?usp=drivesdk', driveId: 'z'}), 'https://drive.google.com/file/d/q/view?usp=drivesdk');
  assert.equal(driveOpenUrl({driveUrl: 'javascript:alert(1)', driveId: 'abc_-1'}), 'https://drive.google.com/file/d/abc_-1/view');
  assert.equal(driveOpenUrl({driveUrl: '', driveId: 'a/b'}), '');
  assert.equal(driveDownloadUrl('abc_-1'), 'https://drive.google.com/uc?export=download&id=abc_-1');
  assert.equal(driveDownloadUrl('a&b'), ''); assert.equal(driveDownloadUrl(''), '');
  assert.equal(canDownload({documentId: 'd'}), true); assert.equal(canDownload({driveId: 'x'}), true); assert.equal(canDownload({}), false);
  assert.equal(canOpenInDrive({driveId: 'x'}), true); assert.equal(canOpenInDrive({}), false);
});

test('pressFile: PDF·사진(보기 없음)은 Drive 보기 새 탭, HWP·그 밖은 내려받기, 사진은 크게 보기', async () => {
  const clicked = fakeDom(), calls = [];
  const api = async (path, o) => { calls.push({path, o}); return {url: 'https://x.test/dl?t=1'}; };
  assert.equal(await pressFile({name: 'a.pdf', driveId: 'p1'}, {api}), 'pdf');
  assert.deepEqual(clicked.pop(), {href: 'https://drive.google.com/file/d/p1/view', target: '_blank', rel: 'noopener noreferrer'});
  assert.equal(await pressFile({name: 'a.hwp', driveId: 'h1'}, {api}), 'download');
  assert.equal(clicked.pop().href, 'https://drive.google.com/uc?export=download&id=h1');
  assert.equal(await pressFile({name: 'a.xlsx', driveId: 'x1', documentId: 'doc-1'}, {api}), 'download');
  assert.deepEqual(calls, [{path: '/functions/v1/workspace-drive?action=download-token', o: {method: 'POST', body: {document_id: 'doc-1'}}}]);
  assert.equal(location.href, 'https://x.test/dl?t=1'); assert.equal(clicked.length, 0);
  let seen = null;
  assert.equal(await pressFile({name: 'p.jpg', driveId: 'ph'}, {viewPhoto: f => { seen = f.driveId; }, api}), 'photo');
  assert.equal(seen, 'ph'); assert.equal(clicked.length, 0);
  assert.equal(await pressFile({name: 'p.jpg', driveId: 'ph'}, {api}), 'photo-drive');
  assert.equal(clicked.pop().href, 'https://drive.google.com/file/d/ph/view');
  // 주소만 적은 자료(파일 없음)는 HWP여도 주소를 연다.
  assert.equal(await pressFile({name: 'a.hwp', driveUrl: 'https://example.org/a'}, {api}), 'link');
  assert.equal(clicked.pop().href, 'https://example.org/a');
});

test('내려받기 실패는 onError로 알리고, 길이 없으면 거절', async () => {
  fakeDom(); const errors = [];
  assert.equal(await downloadFile({documentId: 'd'}, {api: async () => { throw new Error('권한 없음'); }, onError: m => errors.push(m)}), false);
  assert.equal(await downloadFile({documentId: 'd'}, {api: async () => ({}), onError: m => errors.push(m)}), false);
  assert.equal(await downloadFile({}, {onError: m => errors.push(m)}), false);
  assert.equal(openInDrive({}, {onError: m => errors.push(m)}), false);
  assert.deepEqual(errors, ['권한 없음', '다운로드 주소를 받지 못했습니다.', '내려받을 수 있는 파일 링크가 없습니다.', '열 수 있는 파일 링크가 없습니다.']);
});

test('⋯ 메뉴 항목과 줄 속성: 어느 파일이든 두 항목, 이름은 escape', () => {
  const file = {name: '<a>"x".hwp', driveId: 'i1', documentId: 'doc'};
  assert.equal(menuItemsHtml(file), '<button type="button" data-file-menu="open">Drive에서 열기</button><button type="button" data-file-menu="download">내려받기</button>');
  assert.match(menuItemsHtml(file, {attr: 'data-fa-menu', attrs: fileAttrs(file)}), /data-fa-menu="open" data-fa-name="&lt;a&gt;&quot;x&quot;\.hwp"/);
  assert.equal(menuItemsHtml({}), '');
  assert.match(fileAttrs(file, {press: true}), / data-fa-press$/);
});

// PRESS-자료실편입 2단계: viewHtml을 준 화면(자료실)의 .html 자료는 칸막이 보기로, 그 밖은 지금 규칙 그대로.
test('pressFile: .html library document goes to viewHtml; without viewHtml or document id it downloads as before', async () => {
  let shown = null;
  const viewHtml = file => { shown = file; };
  assert.equal(await pressFile({name: '2025-01-22-a.html', documentId: 'd1', driveId: 'f1'}, {viewHtml}), 'html');
  assert.equal(shown.documentId, 'd1');
  assert.equal(await pressFile({name: 'PAGE.HTM', documentId: 'd2', driveId: 'f2'}, {viewHtml}), 'html');
  shown = null;
  const api = async () => ({url: 'https://example.invalid/x'});
  const hadLocation = 'location' in globalThis, saved = globalThis.location;
  globalThis.location = {href: ''};
  try {
    assert.equal(await pressFile({name: 'c.html', documentId: 'd3', driveId: 'f3'}, {api}), 'download', 'no viewHtml: same as before');
    assert.equal(await pressFile({name: 'c.html', driveId: 'f4'}, {viewHtml, api}), 'download', 'no document id: not a library document');
  } finally { if (hadLocation) globalThis.location = saved; else delete globalThis.location; }
  assert.equal(shown, null);
});
