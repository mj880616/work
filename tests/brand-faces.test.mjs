import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FACES, DEFAULT_FACE, faceOf, wordIn } from '../app/brand/faces.mjs';
import { FACE_ID } from '../app/brand/face.mjs';
import { FACE, APP_NAME, word } from '../app/brand/brand.mjs';
import { ITEMS, labelOf } from '../app/menu-model.mjs';

// APP-올인원다이어리 단계 2: 얼굴 설정(app/brand/)과 노동조합+ 화면 글자 불변.
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// 얼굴 기능 전(main 7e50408) 메뉴 이름 그대로. 노동조합+ 얼굴에서는 한 글자도 달라지면 안 된다.
const NOJO_MENU_LABELS = Object.freeze({
  home: '홈', basket: '잊지 말기', calendar: '일정', note: '노트', meetings: '사업 관리', library: '자료실', files: '파일',
  brief: '브리핑 룸', pages: '공유 페이지', team: '조직 관리', hwp: 'HWP 편집', photos: '사진', outside: 'News',
  calls: '통화', telegram: '텔레그램 소식', arsenal: '아스날'
});

test('저장소의 얼굴은 노동조합+ 한 줄이고, 단어표가 비어 모든 글자가 그대로다', () => {
  assert.equal(read('app/brand/face.mjs'), "export const FACE_ID = 'nojo';\n");
  assert.equal(FACE_ID, 'nojo');
  assert.equal(DEFAULT_FACE, 'nojo');
  assert.equal(FACE.id, 'nojo');
  assert.equal(APP_NAME, '노동조합+');
  assert.deepEqual(FACE.words, {});
  for (const text of [...Object.keys(FACES.girok.words), '사업 보고', '홈', '']) assert.equal(word(text), text);
});

test('노동조합+ 메뉴 이름은 얼굴 기능 전과 같다', () => {
  assert.deepEqual(Object.fromEntries(ITEMS.map(item => [item.id, item.label])), NOJO_MENU_LABELS);
  assert.equal(labelOf('meetings'), '사업 관리');
  assert.equal(labelOf('team'), '조직 관리');
});

test('얼굴 두 벌은 같은 칸을 모두 갖고, 켜진 메뉴·화면은 지금 있는 것 안에서만 고른다', () => {
  const keys = ['id', 'name', 'shortName', 'description', 'icon', 'themeColor', 'backgroundColor', 'menu', 'views', 'words'];
  for (const [id, face] of Object.entries(FACES)) {
    assert.deepEqual(Object.keys(face).sort(), [...keys].sort(), id);
    assert.equal(face.id, id);
    assert.ok(Object.isFrozen(face) && Object.isFrozen(face.menu) && Object.isFrozen(face.views) && Object.isFrozen(face.words), `${id} 얼굴은 바꿀 수 없다`);
    assert.match(face.themeColor, /^#[0-9a-f]{6}$/);
    assert.ok(read(face.icon).includes('<svg'), `${id} 아이콘 파일`);
  }
  const menuIds = ITEMS.map(item => item.id);
  assert.deepEqual([...FACES.nojo.menu].sort(), [...menuIds].sort(), '노동조합+는 모든 메뉴가 켜져 있다');
  // 화면 이름 표(topbar-actions.js VIEW_NAMES) + 이름 없는 브리핑 룸 = 지금 있는 화면 전부.
  const viewNames = read('app/topbar-actions.js').match(/const VIEW_NAMES=\{([^}]*)\}/)[1].split(',').map(pair => pair.split(':')[0]);
  assert.deepEqual([...FACES.nojo.views].sort(), [...viewNames, 'brief'].sort());
  for (const id of FACES.girok.menu) assert.ok(menuIds.includes(id), `기록+ 메뉴 ${id}`);
  for (const view of FACES.girok.views) assert.ok(FACES.nojo.views.includes(view), `기록+ 화면 ${view}`);
  for (const off of ['outside', 'brief', 'arsenal', 'calls', 'telegram']) {
    assert.ok(!FACES.girok.menu.includes(off) && !FACES.girok.views.includes(off), `기록+에서 빠지는 ${off}`);
  }
  for (const kept of ['home', 'basket', 'calendar', 'note', 'meetings', 'library', 'files', 'pages', 'team', 'hwp', 'photos']) {
    assert.ok(FACES.girok.menu.includes(kept), `기록+에 남는 ${kept}`);
  }
});

test('기록+ 단어표: 노조 색 단어를 범용 단어로, 표에 없는 글자는 그대로', () => {
  const girok = faceOf('girok');
  assert.equal(girok.name, '기록+');
  assert.equal(wordIn(girok, '사업 관리'), '프로젝트·거래처');
  assert.equal(wordIn(girok, '노동조합+'), '기록+');
  assert.equal(wordIn(girok, '자료실'), '자료실');
  for (const [from, to] of Object.entries(girok.words)) {
    assert.ok(from && to && from !== to, from);
    assert.ok(!/노동조합|노조|조직|사업/.test(to), `${from} → ${to}에 노조 색 단어가 남음`);
  }
  assert.equal(faceOf('없는얼굴').id, 'nojo', '모르는 이름은 노동조합+');
});

test('얼굴은 빌드만 정한다: 주소·기기 저장소·전역 값으로 바꾸는 길이 없다', () => {
  for (const file of ['app/brand/brand.mjs', 'app/brand/faces.mjs', 'app/brand/face.mjs']) {
    const source = read(file).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|location|URLSearchParams|document|window|globalThis|fetch\(/, file);
  }
  assert.doesNotMatch(read('app/brand/brand.mjs').replace(/^\s*\/\/.*$/gm, ''), /\bexport\s+(?:let|var|function\s+set)/, '바꾸는 함수·바뀌는 값 없음');
});

test('노조 색 화면 이름은 단어표를 거쳐 나온다(글자를 곧바로 쓰지 않는다)', () => {
  const top = read('app/topbar-actions.js');
  assert.match(top, /import \{APP_NAME,word\} from '\.\/brand\/brand\.mjs';/);
  assert.match(top, /const APP_TITLE=APP_NAME;/);
  for (const name of ['사업 관리', '조직 관리', '사업영역 관리']) assert.ok(!top.includes(`'${name}'`) || top.split(`'${name}'`).length - 1 === top.split(`word('${name}')`).length - 1, `topbar-actions.js의 '${name}'`);
  const menu = read('app/menu-model.mjs');
  assert.match(menu, /label: word\('사업 관리'\)/);
  assert.match(menu, /label: word\('조직 관리'\)/);
  assert.match(read('app/basket-note-tasks.js'), /projects:word\('사업영역'\),team:word\('조직 관리'\)/);
});
