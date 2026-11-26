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
  home: '홈', basket: '잊지 말기', reading: '저장한 글', calendar: '일정', note: '노트', meetings: '사업 관리', library: '자료실', files: '파일',
  brief: '브리핑 룸', team: '조직 관리', photos: '사진', outside: '읽을 거리', // S68-34(11/23 사용자): News → 읽을 거리, 읽을 거리 → 저장한 글
  calls: '통화', telegram: '텔레그램 소식', arsenal: '아스날'
});

test('저장소의 얼굴은 nojo(지금 운영) 한 줄이고, 단어표가 비어 모든 글자가 그대로다', () => {
  assert.equal(read('app/brand/face.mjs'), "export const FACE_ID = 'nojo';\n");
  assert.equal(FACE_ID, 'nojo');
  assert.equal(DEFAULT_FACE, 'nojo');
  assert.equal(FACE.id, 'nojo');
  assert.equal(APP_NAME, 'WORK ON+', '앱 이름은 WORK ON+(2026-11-21 명진 확정)');
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
  const viewNames = [...read('app/topbar-actions.js').match(/const VIEW_NAMES=\{([^}]*)\}/)[1].matchAll(/(?:^|,)(\w+):/g)].map(m => m[1]);
  assert.deepEqual([...FACES.nojo.views].sort(), [...viewNames, 'brief'].sort());
  for (const id of FACES.girok.menu) assert.ok(menuIds.includes(id), `기록+ 메뉴 ${id}`);
  for (const view of FACES.girok.views) assert.ok(FACES.nojo.views.includes(view), `기록+ 화면 ${view}`);
  for (const off of ['outside', 'brief', 'arsenal', 'calls', 'telegram']) {
    assert.ok(!FACES.girok.menu.includes(off) && !FACES.girok.views.includes(off), `기록+에서 빠지는 ${off}`);
  }
  for (const kept of ['home', 'basket', 'reading', 'calendar', 'note', 'meetings', 'library', 'files', 'team', 'photos']) {
    assert.ok(FACES.girok.menu.includes(kept), `기록+에 남는 ${kept}`);
  }
});

test('기록+ 단어표: 2026-11-20 명진 결정 단어, 표에 없는 글자는 그대로', () => {
  const girok = faceOf('girok');
  assert.equal(girok.name, 'WORK ON+');
  assert.equal(girok.shortName, 'WORK ON+');
  assert.equal(girok.icon, FACES.nojo.icon, '두 얼굴이 같은 표장 A');
  assert.equal(wordIn(girok, 'WORK ON+'), 'WORK ON+', '앱 이름은 단어표 밖');
  assert.equal(wordIn(girok, '노조 플러스'), 'WORK ON+');
  assert.equal(wordIn(girok, '사업 관리'), '활동 기록');
  assert.equal(wordIn(girok, '사업영역 관리'), '프로젝트 관리');
  assert.equal(wordIn(girok, '조직 관리'), '거래처·직원', '메뉴·아래 탭은 짧은 꼴');
  assert.equal(wordIn(girok, '조직 관리', 'title'), '거래처·부서·직원', '화면 제목');
  assert.equal(wordIn(girok, '자료실'), '자료실');
  assert.equal(wordIn(girok, '자료실', 'title'), '자료실', '자리 열쇠가 없으면 글자 그대로');
  for (const [from, to] of Object.entries(girok.words)) {
    assert.ok(from && to && from !== to, from);
    assert.ok(!/노동조합|노조|조직|사업 ?보고|사업영역|투쟁|교섭|상집|조합원/.test(to.replace(/="[^"]*"/g, "")), `${from} → ${to}에 노조 색 단어가 남음`);
    assert.ok(!/[•∙・]/.test(to), `${to}: 가운데점은 '·'만`);
  }
  assert.equal(faceOf('없는얼굴').id, 'nojo', '모르는 이름은 노동조합+');
});

test('기록+ 문장 안 낱말 바꾸기: 긴 말이 먼저, 조사는 새 말에 맞춘다', () => {
  const girok = faceOf('girok');
  const cases = {
    '사업영역을 고르세요': '프로젝트를 고르세요',
    '사업영역으로 옮기기': '프로젝트로 옮기기',
    '사업영역이 없습니다': '프로젝트가 없습니다',
    '담당조직이 없습니다': '관리 대상이 없습니다',
    '투쟁사업장은 3곳': '주요 거래처는 3곳',
    '투쟁사업장과 함께': '주요 거래처와 함께',
    '사업 보고 쓰기': '활동 기록 쓰기',
    '조합원을 찾기': '구성원을 찾기',
    '사업영역이름': '프로젝트이름'
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(wordIn(girok, from), to, from);
  assert.equal(wordIn(girok, ''), '');
  assert.equal(wordIn(girok, null), null);
});

test('기록+ 활동 기록 기본 분류(화면 글자만, DB 값은 그대로)', () => {
  const girok = faceOf('girok');
  const kinds = { 회의: '회의', 정책: '기획', 교섭: '협의', 언론: '홍보', 국회: '외근', 투쟁: '행사', 교육: '교육', 기타: '기타' };
  for (const [from, to] of Object.entries(kinds)) {
    assert.equal(wordIn(girok, from, 'kind'), to, from);
    assert.equal(wordIn(FACES.nojo, from, 'kind'), from, `노동조합+ ${from}`);
  }
});

test('노동조합+ 얼굴: word()는 어떤 글자·자리·태그 템플릿이든 그대로 돌려준다', () => {
  for (const text of ['담당조직을 고르세요', '사업영역', '조직 관리', '투쟁사업장', '노동조합+']) {
    assert.equal(word(text), text);
    assert.equal(word(text, 'title'), text);
    assert.equal(word(text, 'kind'), text);
  }
  const name = '○○ 노조 투쟁사업장', count = 3;
  assert.equal(word`${name} 담당조직 ${count}곳`, `${name} 담당조직 ${count}곳`);
  assert.equal(word`담당조직`, '담당조직');
  assert.equal(word``, '');
});

test('기록+ 태그 템플릿: 사용자 글(${값})은 바꾸지 않고 고정 조각만 바꾼다', () => {
  const girok = faceOf('girok');
  const tag = (strings, ...values) => strings.reduce((out, part, i) => out + (i ? String(values[i - 1]) : '') + wordIn(girok, part), '');
  const name = '○○ 노조 투쟁사업장';
  assert.equal(tag`${name}의 담당조직 ${2}곳`, `${name}의 관리 대상 2곳`);
});

test('얼굴은 빌드만 정한다: 주소·전역 값·네트워크로 바꾸는 길이 없다', () => {
  for (const file of ['app/brand/brand.mjs', 'app/brand/faces.mjs', 'app/brand/face.mjs']) {
    const source = read(file).replace(/^\s*\/\/.*$/gm, '');
    // 기기 저장소는 browser-storage-audit.yml이 app/ 전체에서 막는다. 여기서는 주소·화면·전역 값·네트워크로 얼굴을 고르는 길이 없는지 본다.
    assert.doesNotMatch(source, /location|URLSearchParams|document|window|globalThis|navigator|fetch\(/, file);
  }
  assert.doesNotMatch(read('app/brand/brand.mjs').replace(/^\s*\/\/.*$/gm, ''), /\bexport\s+(?:let|var|function\s+set)/, '바꾸는 함수·바뀌는 값 없음');
});

test('노조 색 화면 이름은 단어표를 거쳐 나온다(글자를 곧바로 쓰지 않는다)', () => {
  const top = read('app/topbar-actions.js');
  assert.match(top, /import \{APP_NAME,word\} from '\.\/brand\/brand\.mjs';/);
  assert.match(top, /const APP_TITLE=APP_NAME;/);
  for (const name of ['사업 관리', '조직 관리', '사업영역 관리']) assert.ok(!top.includes(`'${name}'`) || top.split(`'${name}'`).length - 1 === top.split(`word('${name}'`).length - 1, `topbar-actions.js의 '${name}'`);
  const menu = read('app/menu-model.mjs');
  assert.match(menu, /label: word\('사업 관리'\)/);
  assert.match(menu, /label: word\('조직 관리'\)/);
  assert.match(read('app/basket-note-tasks.js'), /projects:word\('사업영역'\),team:word\('조직 관리'\)/);
});

// S68-56(명진 11/23 15:06·15:12): 브리핑은 미리 정한 칸 이름을 쓰지 않는다(소제목은 AI가 자료에서 정함). 단어표의 브리핑 칸 열쇠('#brief')도 없앴다.
test('S68-56 브리핑: 단어표에 고정 칸 이름 열쇠가 없고, 옛 형식 소제목에 노조 색 글자가 없다', async () => {
  const {GIROK_WORDS} = await import('../app/brand/girok-words.mjs');
  assert.deepEqual(Object.keys(GIROK_WORDS).filter(k => k.endsWith('#brief')), []);
  const {briefView} = await import('../app/brief-room-model.mjs');
  const titles = briefView({ v: 2, lead: 'x', todos: [{ text: 'a' }], orgs: [{ text: 'b' }], counters: [{ claim: 'c' }] }).sections.map(s => s.title);
  for (const t of titles) assert.doesNotMatch(t, /조직|노조|사업/);
});

// S68-02(11/22 명진 결정): WORK ON+ 기본 얼굴(girok)에 남은 노조 단어 — 한글 문서 서식 버튼·편집 백업·백업·휴지통 폴더 이름·PC 도우미 글자.
// 명진 화면(운영자 기능 nojo_words = 바탕 낱말 묶음 'nojo')은 지금 글자 그대로.
test('S68-02: girok에서는 서식·WORK ON+ 글자, nojo_words 바탕에서는 지금 글자 그대로', async () => {
  const { withWordBase } = await import('../app/brand/custom-words-model.mjs');
  const girok = FACES.girok, mine = withWordBase(girok, 'nojo');
  const cases = [
    ['노조 양식으로 새 문서', '서식으로 새 문서'],
    ['노조 서식으로 만들기', '서식으로 만들기'],
    ['노조 양식 스타일', '서식 스타일'],
    ['노조+ 편집 백업', 'WORK ON+ 편집 백업'],
    ['노조+ 백업', 'WORK ON+ 백업'],
    ['노조+ 휴지통으로', 'WORK ON+ 휴지통으로'],
    ['노조+ 파일 올리기', 'WORK ON+ 파일 올리기'],
    ['노조+ 파일 올리기 도우미가 로그아웃돼 있어요.', 'WORK ON+ 파일 올리기 도우미가 로그아웃돼 있어요.'],
    ['폰(사진첩 노조+ 폴더)에 받아 수정해요.', '폰(사진첩 WORK ON+ 폴더)에 받아 수정해요.'],
  ];
  for (const [text, want] of cases) {
    assert.equal(wordIn(girok, text), want, text);
    assert.equal(wordIn(mine, text), text, `nojo_words: ${text}`);
    assert.equal(wordIn(FACES.nojo, text), text, `nojo 얼굴: ${text}`);
  }
  // '노조+'는 '노조'(→ 단체)보다 먼저 걸린다.
  assert.equal(wordIn(girok, '노조+ 백업과 노조 일정'), 'WORK ON+ 백업과 단체 일정');
});

test('S68-02: 앱 바탕 한글 문서 버튼은 girok 빌드에서 서식, 원래 글자를 남겨 nojo_words 사람은 되찾는다', async () => {
  const { faceHtml } = await import('../scripts/brand-face.mjs');
  const { applyShellWords } = await import('../app/brand/custom-words-shell.mjs');
  const html = read('app/index.html');
  const built = faceHtml(html, FACES.girok, { keepOriginals: true });
  assert.match(built, /id="hwpLabTemplate"[^>]*><!--word:노조 양식으로 새 문서-->서식으로 새 문서</);
  assert.match(built, /id="hwpLabConvert"[^>]*><!--word:노조 서식으로 만들기-->서식으로 만들기</);
  assert.ok(typeof applyShellWords === 'function');
});

test('S68-02: 화면 글자가 word()를 거친다 — HWP 스타일 묶음 이름·폴더 안내·PC 도우미, 조사 오타 없음', () => {
  const frame = read('app/hwp-frame.js'), styles = read('app/hwp-lab/studio-styles.js');
  assert.match(frame, /export const STYLE_GROUP_LABEL=word\('노조 양식 스타일'\);/);
  assert.match(frame, /iframe\.src=studioFrameSrc\(studioUrl\);/);
  assert.match(styles, /group\.setAttribute\('aria-label',groupLabel\(\)\);/);
  assert.doesNotMatch(styles, /'노조 양식 스타일'/);
  // S69-42: 앱 폴더 기본 이름은 누구나 새 이름(서버가 쓸 때 옛 이름을 바꿈) — word()를 거치지 않는 고정 글자.
  assert.match(read('app/hwp-drive.js'), /export const EDIT_BACKUP_FOLDER='WORK ON\+ 편집 백업';/);
  assert.match(read('app/record-backup.js'), /export const DEFAULT_FOLDER = 'WORK ON\+ 백업';/);
  for (const file of ['app/pc-files-model.mjs', 'app/files.js', 'app/help-content.mjs', 'app/app-download.mjs']) {
    const src = read(file);
    assert.doesNotMatch(src, /도우미을|도우미이 /, `${file}: 조사`);
    // S68-21: 도우미 프로그램 자체 이름이 모두에게 'WORK ON+ 파일 올리기'(basket-pc TrayStatus.Name)라 화면 안내도 같은 글자(옛 이름 없음).
    for (const line of src.split('\n').filter(l => !/^\s*\/\//.test(l))) assert.doesNotMatch(line, /노조\+ 파일 올리기|노조\+에서 이 PC 보기/, `${file}: ${line.trim().slice(0, 60)}`);
  }
});

// S68-21(명진 11/22 17:04): PC 도우미 프로그램 자체 글자 — 웹 안내가 가리키는 이름·트레이 메뉴와 프로그램 소스가 같다.
test('S68-21: PC 도우미 이름·트레이 메뉴는 웹 안내와 프로그램이 같은 WORK ON+ 글자', async () => {
  const { PC_TRAY_SHOW_ITEM } = await import('../app/pc-files-model.mjs');
  const { PC_HELPER_NAME } = await import('../app/app-download.mjs');
  const tray = read('basket-pc/src/BasketDrop/TrayApp.cs'), status = read('basket-pc/src/BasketDrop.Core/TrayStatus.cs');
  assert.equal(PC_HELPER_NAME, 'WORK ON+ 파일 올리기');
  assert.match(status, new RegExp(`public const string Name = "${PC_HELPER_NAME.replace('+', '\\+')}";`));
  assert.ok(tray.includes(`new("${PC_TRAY_SHOW_ITEM}")`), '트레이 메뉴 글자가 웹 안내와 같다');
  assert.match(read('.github/workflows/basket-pc-release.yml'), /--packTitle "WORK ON\+ 파일 올리기"/);
  // 설치 ID·실행 파일·자동 시작 이름은 그대로(이미 깔린 PC의 업데이트·자동 시작이 끊기지 않게).
  assert.match(read('.github/workflows/basket-pc-release.yml'), /PACK_ID: BasketDropApp/);
  assert.match(read('basket-pc/src/BasketDrop/RegistryStartup.cs'), /ValueName = "BasketDrop"/);
  assert.match(read('basket-pc/src/BasketDrop.Core/RenamedShortcuts.cs'), /"노조\+ 파일 올리기\.lnk"\]/, '옛 바로가기는 새 바로가기가 생긴 뒤 지움');
});
