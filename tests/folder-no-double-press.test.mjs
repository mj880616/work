// S69-76 UI-두번누르기없앰(사용자 11/24 21:30 "폴더 두번 누르면 들어가지는데 너무 민감 더블클릭 없애고 그 폴더에 들어가는 건 ... 해서 들어가기로만"):
// 파일·자료실·노트·사진 폴더 화면에 '두 번 누르기(dblclick) = 폴더 들어가기' 처리가 다시 생기지 않게 원본을 본다.
// 화면 동작은 tests/app-e2e/standard-interactions.spec.mjs T8이 본다(docs/design/standard-interactions.md T8).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const APP = new URL('../app/', import.meta.url);
const read = f => readFileSync(new URL(f, APP), 'utf8');
// 폴더 나무·목록을 그리는 화면 파일들.
const FOLDER_SCREENS = readdirSync(APP).filter(f => /^(files|library-|folder-|note-folder|basket-notes|photos)[\w-]*\.(js|mjs)$/.test(f));
// dblclick 처리 몸통(다음 처리 시작 전까지 넉넉히 600자).
const bodies = src => [...src.matchAll(/addEventListener\(\s*['"]dblclick['"]\s*,/g)].map(m => src.slice(m.index, m.index + 600));
const ENTER = /luEnterFolder|goFolder|enterFolder|focusTreeFolder|FOLDER_ENTER|\.enter\(/;

test('폴더 화면 파일 목록을 찾는다', () => {
  for (const f of ['files.js', 'library-upload.js', 'basket-notes.js', 'photos.js']) assert.ok(FOLDER_SCREENS.includes(f), f);
});

test('자료실: 폴더 줄 두 번 누르기 = 들어가기 처리가 없다', () => {
  const src = read('library-upload.js');
  assert.equal(bodies(src).length, 0, 'library-upload.js에 dblclick 처리가 다시 생겼다');
  assert.doesNotMatch(src, /두 번 누르면\(PC 더블클릭, 폰 두 번 탭\) 그 폴더로 들어간다/);
});

test('파일·자료실·노트·사진: 어떤 dblclick 처리도 폴더로 들어가지 않는다', () => {
  for (const f of FOLDER_SCREENS) {
    for (const body of bodies(read(f))) {
      const end = body.indexOf('\n});');
      const own = end > 0 ? body.slice(0, end) : body;
      assert.doesNotMatch(own, ENTER, `${f}: dblclick 처리가 폴더 들어가기를 부른다`);
    }
  }
});

test('파일: 줄 두 번 누르기는 파일(폴더 아님)만 연다', () => {
  const [body] = bodies(read('files.js'));
  assert.ok(body, 'files.js 파일 열기 dblclick');
  assert.match(body.slice(0, body.indexOf('});')), /!r\.is_folder\)\s*openCloud\(r\)/);
});
