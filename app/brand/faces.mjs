// APP-올인원다이어리 단계 2(docs/design/allinone-diary-plan.md): 같은 코드에 얼굴 둘. 얼굴마다 다른 것은 이 파일 한 곳에만 둔다.
// DOM·네트워크·기기 저장소 없음. 어떤 얼굴인지는 빌드가 정한다(app/brand/face.mjs 한 줄, scripts/brand-face.mjs가 고쳐 씀).
// 실행 중 사용자 조작·주소·로컬 저장으로 바뀌지 않는다.
//
// nojo  = 노동조합+(노조 플러스, 지금 운영). 단어표가 비어 있어 모든 글자가 지금 그대로다(tests/brand-faces.test.mjs).
// girok = 기록+(범용 업무 관리 앱, 2026-11-20 명진 이름 확정). 아이콘은 시안 전이라 임시 그림이다.
//
// menu: 켜진 메뉴 id(app/menu-model.mjs ITEMS의 id). views: 켜진 화면(라우터 이름).
//   단계 2에서는 목록만 둔다. 실제로 메뉴·경로를 빼고 서버가 거절하는 일은 단계 3(화면 숨김이 아니라 제거 + 서버 거절, AGENTS.md 5절).
// words: 노조 색 단어 → 이 얼굴의 단어. 화면 이름·메뉴 글자는 app/brand/brand.mjs의 word()를 거쳐 나온다.
//   기록+ 단어는 임시안이다(명진 확인 전). 바꿀 때는 이 표만 고친다.

const ALL_MENU = Object.freeze(['home', 'basket', 'calendar', 'note', 'meetings', 'library', 'files', 'brief', 'pages', 'team', 'hwp', 'photos', 'outside', 'calls', 'telegram', 'arsenal']);
const ALL_VIEWS = Object.freeze(['home', 'basket', 'calendar', 'tasks', 'diary', 'projects', 'library', 'files', 'meetings', 'pages', 'team', 'hwp', 'profile', 'updates', 'whatsnew', 'help', 'lock', 'feedback', 'signups', 'ledger', 'search', 'reference', 'photos', 'brief', 'calls', 'telegram', 'arsenal', 'outside']);
// 기록+에서 빠지는 것(계획 '남기는 것 / 빼는 것'): News·브리핑 룸·아스날, 통화·텔레그램(원래 운영자 전용).
const GIROK_OFF = Object.freeze(['outside', 'brief', 'arsenal', 'calls', 'telegram']);

export const DEFAULT_FACE = 'nojo';

export const FACES = Object.freeze({
  nojo: Object.freeze({
    id: 'nojo',
    name: '노동조합+',
    shortName: '노동조합+',
    description: '노동조합+ — 노동조합 업무 보조',
    icon: 'app/app-icon.svg',
    themeColor: '#f3f1ea',
    backgroundColor: '#f3f1ea',
    menu: ALL_MENU,
    views: ALL_VIEWS,
    words: Object.freeze({})
  }),
  girok: Object.freeze({
    id: 'girok',
    name: '기록+',
    shortName: '기록+',
    description: '기록+ — 일정·할 일·노트·자료를 한곳에',
    // 임시 아이콘(시안 고르기는 계획 단계 1, 명진). 빌드가 app/app-icon.svg 자리에 넣는다.
    icon: 'app/brand/girok/app-icon.svg',
    themeColor: '#eef0f1',
    backgroundColor: '#eef0f1',
    menu: Object.freeze(ALL_MENU.filter(id => !GIROK_OFF.includes(id))),
    views: Object.freeze(ALL_VIEWS.filter(id => !GIROK_OFF.includes(id))),
    words: Object.freeze({
      '노동조합+': '기록+',
      '사업 관리': '프로젝트·거래처',
      '사업영역 관리': '프로젝트 관리',
      '사업영역': '프로젝트',
      '조직 관리': '사람 수첩',
      '담당조직': '사람 수첩'
    })
  })
});

export const faceOf = id => FACES[Object.hasOwn(FACES, id) ? id : DEFAULT_FACE];

/** 이 얼굴에서 노조 색 단어 하나가 어떻게 보이나. 표에 없는 글자는 그대로. */
export const wordIn = (face, text) => Object.hasOwn(face.words, text) ? face.words[text] : text;
