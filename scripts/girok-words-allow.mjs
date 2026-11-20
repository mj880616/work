// APP-올인원다이어리 단계 3(단어, S67-43): 기록+ 금지어 검사(scripts/check-girok-words.mjs)의 예외 한 곳.
// 여기 있는 글자는 기록+ 화면에 나오지 않는다. 줄마다 왜 화면에 안 나오는지 적는다.
//   file: app/ 아래 경로(끝이 /면 그 폴더 전체). text: 이 조각이 든 글자만(없으면 파일 전체).
// 꺼진 화면(기록+ faces.mjs GIROK_OFF: News·브리핑 룸·아스날·통화·텔레그램)은 단계 3 다음 PR에서 메뉴·경로를 뺀다.
const OFF = '기록+에서 꺼진 화면(메뉴·경로 제거는 단계 3 다음 PR)';

export const GIROK_ALLOW = Object.freeze([
  // ── 꺼진 화면 ──
  { file: 'app/arsenal/', reason: OFF },
  { file: 'app/brand/faces.mjs', text: '노동조합', reason: '노동조합+ 얼굴 정의(기록+는 GIROK 값만 씀)' },

  // ── 묶음 A ──

  // ── 묶음 A 끝 ──


  // ── 묶음 B ──

  // ── 묶음 B 끝 ──


  // ── 묶음 C ──

  // ── 묶음 C 끝 ──


  // ── 묶음 D ──
  { file: 'app/document-categories.js', reason: '자료 분류 이름은 사람별 목록(프로필)·DB 기본값과 같은 저장 값이고, 화면은 그 사람 목록 이름을 그대로 보인다(기록+ 기본 분류는 새 서버 DB 기본값에서 정함)' },
  { file: 'app/files-auto-model.mjs', reason: '서버(Edge)가 만드는 Drive 폴더 실제 이름과 맞추는 값(겸용) — 폴더 이름을 얼굴별로 바꾸는 일은 서버 쪽' },
  { file: 'app/photos-model.mjs', text: '.노조+ 휴지통', reason: 'Drive 휴지통 폴더 실제 이름(서버와 같은 값, 겸용)' },
  { file: 'app/photos.js', text: 'Pictures/노조+/', reason: '폰 사진첩 폴더 실제 경로(폰 앱과 같은 값)' },
  { file: 'app/photos.js', text: '사진첩 노조+ 폴더', reason: '폰 사진첩 실제 폴더 이름을 가리킴(폰 앱 폴더 이름이 얼굴별이 되면 함께 바꿈)' },
  { file: 'app/photos.js', text: '노조+ 휴지통으로', reason: 'Drive 휴지통 실제 폴더 이름을 가리킴(겸용)' },
  { file: 'app/hwp-drive.js', text: '노조 서식', reason: '자료실 분류 저장 값(UNION_TEMPLATE_CATEGORY, 겸용) — 기록+ 값은 명진 결정 필요' },
  { file: 'app/hwp-drive.js', text: '노조+ 편집 백업', reason: '서버가 만드는 Drive 백업 폴더 실제 이름을 가리킴' },
  { file: 'app/hwp-lab.js', text: '노조+ 편집 백업', reason: '서버가 만드는 Drive 백업 폴더 실제 이름을 가리킴' },
  { file: 'app/hwp-lab/studio-styles.js', reason: '편집기 iframe 안 classic script(import 불가) — HWP 노조 양식 스타일 기능 자체가 명진 결정 필요' },
  { file: 'app/files.js', text: '노조+ 파일 올리기 도우미', reason: 'PC 도우미 프로그램 실제 이름(windows-app) — 기록+판 도우미 이름은 명진 결정 필요' },
  { file: 'app/pc-files-model.mjs', text: '노조+ 파일 올리기', reason: 'PC 도우미 프로그램 실제 이름·메뉴 글자(windows-app) — 기록+판 도우미 이름은 명진 결정 필요' },
  { file: 'app/library-sort-model.mjs', text: '성명서', reason: '파일 이름 안 문서 종류 낱말을 찾는 비교 값(사용자 글 읽기)' },
  { file: 'app/ledger-import-model.mjs', text: '조직', reason: '사용자 원장 시트의 탭·칸 이름과 맞추는 읽기 값(원장 양식)' },
  { file: 'app/ledger-import-model.mjs', text: '노조+연결ID', reason: '사용자 원장 시트의 칸 이름과 맞추는 읽기 값(원장 양식)' },

  // ── 묶음 D 끝 ──
].map(Object.freeze));
