// APP-올인원다이어리 단계 3(단어, S67-43): 기록+ 금지어 검사(scripts/check-girok-words.mjs)의 예외 한 곳.
// 여기 있는 글자는 기록+ 화면에 나오지 않는다. 줄마다 왜 화면에 안 나오는지 적는다.
//   file: app/ 아래 경로(끝이 /면 그 폴더 전체). text: 이 조각이 든 글자만(없으면 파일 전체).
// 꺼진 화면(기록+ faces.mjs GIROK_OFF: News·브리핑 룸·아스날·통화·텔레그램)은 단계 3 다음 PR에서 메뉴·경로를 뺀다.
// 기록+ 화면에 나오면 안 되는 노조 색 글자(scripts/check-girok-words.mjs·tests/build-pages/girok-face-boot.spec.mjs가 같이 쓴다).
export const FORBIDDEN = /노동조합|노조|조합원|투쟁|교섭|상집|담당\s?조직|사업\s?영역|사업\s?보고|사업\s?관리|조직|국회|성명서|단협|위원장|지부|지회|쟁의|파업|사업장/;

// S67-63: 사용 안내 글(쓰는 법·빈 화면 안내·앱 내려받기 안내) 파일은 더 엄하게 본다. 위 금지어에 더해, 노조 업무를 전제한
// 예시 낱말과 '주간 보고'(WORK ON 기본은 '주간 정리')도 기록+ 글자에 남으면 안 된다. 예외(GIROK_ALLOW)는 이 파일들에 쓰지 않는다.
export const GUIDE_FILES = Object.freeze(['app/help-content.mjs', 'app/first-use.js', 'app/help.js', 'app/help-link.js', 'app/app-download-guide.js']);
export const GUIDE_FORBIDDEN = new RegExp(`${FORBIDDEN.source}|주간\\s?보고|집회|사측|분회|임금|사무장|단체협약|조직\\s?확대|운영위원회|사업별|이번 주 사업|사업\\s?만들기`);

const OFF = '기록+에서 꺼진 화면(메뉴·경로 제거는 단계 3 다음 PR)';
const NAV_ORGBIZ = '[조직·사업] 메뉴·큰 탭 이름은 모든 사람 같은 글자(2026-11-28 사용자 결정, NAV-조직사업합침)';

export const GIROK_ALLOW = Object.freeze([
  // ── 꺼진 화면 ──
  { file: 'app/arsenal/', reason: OFF },
  { file: 'app/brand/faces.mjs', text: '노동조합', reason: '노동조합+ 얼굴 정의(기록+는 GIROK 값만 씀)' },
  { file: 'app/brand/girok-words.mjs', text: '<option value="', reason: '단어표 값: 저장되는 option 값(옛 값 그대로)만 남기고 보이는 글자는 기록+ 말' },
  { file: 'app/brand/custom-words-model.mjs', reason: '사람별 이름 칸이 맡는 단어표 열쇠(노조 글자 → 칸 id 찾기용, 화면 글자 아님 — 화면에는 얼굴 기본 이름이나 사람이 쓴 이름이 나옴, S67-44)' },

  // ── 묶음 A ──
  { file: 'app/call-feed.js', reason: OFF },
  { file: 'app/telegram-feed.js', reason: OFF },
  { file: 'app/tg-mark-model.mjs', reason: OFF },
  { file: 'app/brief-room-model.mjs', reason: OFF },
  { file: 'app/now-detail.js', reason: `${OFF} — News 상세(outside-statements.js만 부름)` },
  { file: 'app/feed-model.mjs', text: '공공운수노조', reason: '통화 제목에서 운영자 자기 조직을 떼는 데이터 비교 값(화면 글자 아님)' },
  { file: 'app/feed-model.mjs', text: '업무 통화로 옮겼어요', reason: `${OFF} — 통화 알림 글` },
  { file: 'app/feed-model.mjs', text: '개인 통화함', reason: `${OFF} — 통화 알림 글` },
  { file: 'app/feed-model.mjs', text: '조직·이름을 수정했어요', reason: `${OFF} — 통화 상대 고치기 알림` },
  { file: 'app/calendar-ref-model.mjs', text: '조합원 총회', reason: '사용자 일정 제목에서 참고 일정을 고르는 낱말 목록(사용자 글 읽기용, 화면 글자 아님)' },
  { file: 'app/calendar-ref-model.mjs', text: '투쟁', reason: '사용자 일정 제목에서 참고 일정을 고르는 낱말 목록(사용자 글 읽기용, 화면 글자 아님)' },
  { file: 'app/calendar-ref-model.mjs', text: '(조직 캘린더 일정)', reason: '주간 정리 AI에 보내는 자료 줄 머리말(서버·AI로 보내는 글, 화면 글자 아님)' },
  { file: 'app/forget-list.js', text: '- 출처: 노동조합+', reason: "원장 '쓰기요청' 붙여넣기 글 형식: todo-radar-data.js ledgerRequestText와 같은 글자를 찾아 바꿈(겸용, 형식이 얼굴별로 갈리면 안 됨)" },
  { file: 'app/todo-radar-data.js', text: '- 출처: 노동조합+', reason: "원장 '쓰기요청' 붙여넣기 글 형식(겸용, forget-list.js가 같은 글자로 찾음)" },
  { file: 'app/google-tasks.js', text: '[Google Tasks] 조직 순서표 미등록', reason: '개발자 콘솔 경고(console.warn, 화면 글자 아님)' },
  { file: 'app/legacy/startup-speed.js', reason: '불러오는 곳 없는 옛 classic script(app 어디서도 쓰지 않음)' },
  { file: 'app/task-layout.js', reason: '불러오는 곳 없는 옛 파일(view-loader는 task-layout.css만 씀)' },

  // ── 묶음 A 끝 ──


  // ── 묶음 B ──
  { file: 'app/activity-photo-model.mjs', text: '교섭', reason: '자료실 종류 이름 맞추기(데이터 값, 화면에는 자료실 종류로 보임)' },
  { file: 'app/activity-photo-model.mjs', text: '투쟁', reason: '자료실 종류 이름 맞추기(데이터 값)' },
  { file: 'app/ask-web2-model.mjs', text: '교섭·전략', reason: '서버 답의 꼬리표 값 비교(데이터 값)' },
  { file: 'app/journal-draft-model.mjs', text: '조직 소식', reason: 'AI 초안 재료 줄 꼬리표(서버로 보내는 글, 화면에 안 보임)' },
  { file: 'app/weekly-major-schedule.mjs', reason: '노조식 주간 보고 주요 일정 기준: AI 지시문·사용자 일정 이름 맞추기 단어(기록+에서 끌지 명진 결정 필요)' },
  { file: 'app/weekly-group-names.mjs', text: '현황', reason: "서버 사본(supabase/functions/_shared/weekly-group-names.mjs)과 바이트까지 같아야 해 brand를 부를 수 없음. 양식 제목이 없을 때만 쓰는 기본 묶음 이름 '사업장 현황'·'조직 현황' — 주간 보고 학습 묶음(노조식 주간 보고와 함께 명진 결정)" },

  // ── 묶음 B 끝 ──


  // ── 묶음 C ──
  { file: 'app/org-name-match.mjs', text: '노조', reason: '사용자가 쓴 조직 이름 맞추기(노동조합→노조 줄임 비교), 화면에 안 나옴' },
  { file: 'app/org-dispute-stage-model.mjs', reason: '겸용: 처음 열 때 DB에 넣는 기본 단계 이름(이후 사용자 글). 노조 전용 구조라 기록+에서 끌지 명진 결정 필요' },

  // ── 묶음 C 끝 ──


  // ── 묶음 D ──
  { file: 'app/document-categories.js', reason: '자료 분류 이름은 사람별 목록(프로필)·DB 기본값과 같은 저장 값이고, 화면은 그 사람 목록 이름을 그대로 보인다(기록+ 기본 분류는 새 서버 DB 기본값에서 정함)' },
  { file: 'app/files-auto-model.mjs', reason: '서버(Edge)가 만드는 Drive 폴더 실제 이름과 맞추는 값(겸용) — 폴더 이름을 얼굴별로 바꾸는 일은 서버 쪽' },
  { file: 'app/photos-model.mjs', text: '.노조+ 휴지통', reason: '원드라이브 휴지통 폴더 실제 이름(이미 있는 폴더 이름, 서버와 같은 값) — 폴더 이름 거절용, 화면 글자 아님' },
  { file: 'app/photos.js', text: 'Pictures/노조+/', reason: '폰 사진첩 폴더 실제 경로(폰 앱과 같은 값)' },
  { file: 'app/hwp-drive.js', text: '노조 서식', reason: "이미 저장된 자료실 분류 값 '노조 서식'을 찾는 비교 값(UNION_TEMPLATE_NOJO_CATEGORY, 화면 글자 아님). 새 분류 이름은 word('노조 서식') — S68-21" },
  { file: 'app/library-sort-model.mjs', text: '성명서', reason: '파일 이름 안 문서 종류 낱말을 찾는 비교 값(사용자 글 읽기)' },
  { file: 'app/ledger-import-model.mjs', text: '조직', reason: '사용자 원장 시트의 탭·칸 이름과 맞추는 읽기 값(원장 양식)' },
  { file: 'app/ledger-import-model.mjs', text: '노조+연결ID', reason: '사용자 원장 시트의 칸 이름과 맞추는 읽기 값(원장 양식)' },

  // ── 묶음 D 끝 ──


  // ── NAV-조직사업합침(2026-11-28 사용자 결정 "조직·사업으로 하고 운영자 외 사용자에게도 그렇게 해줘 거래처 활동 말고") ──
  // [조직·사업] 메뉴 이름과 그 안 큰 탭 이름 [조직 관리][사업 관리]는 WORK ON+ 기본에서도 이 글자다(이 메뉴에 한해 2026-11-20
  // '기본 화면에 노조 색 단어를 두지 않는다'를 바꿈, docs/design/allinone-diary-plan.md). 탭 안 화면 글자는 그대로 단어표를 거친다.
  { file: 'app/index.html', text: '조직·사업', reason: NAV_ORGBIZ },
  { file: 'app/menu-model.mjs', text: '조직·사업', reason: NAV_ORGBIZ },
  { file: 'app/topbar-actions.js', text: '조직·사업', reason: NAV_ORGBIZ },
  { file: 'app/org-biz-tabs.js', text: '조직·사업', reason: NAV_ORGBIZ },
  { file: 'app/org-biz-tabs.mjs', text: '조직 관리', reason: `${NAV_ORGBIZ} — 큰 탭 글자는 word(글자, 'tab')를 거쳐 고친 이름이 있으면 그 이름` },
  { file: 'app/org-biz-tabs.mjs', text: '사업 관리', reason: `${NAV_ORGBIZ} — 큰 탭 글자는 word(글자, 'tab')를 거쳐 고친 이름이 있으면 그 이름` },
  { file: 'app/brand/girok-words.mjs', text: '조직·사업', reason: `${NAV_ORGBIZ} — 단어표의 글자 그대로 두는 값` },
  { file: 'app/brand/girok-words.mjs', text: '조직 관리', reason: `${NAV_ORGBIZ} — 단어표의 큰 탭 자리('#tab') 값` },
  { file: 'app/brand/girok-words.mjs', text: '사업 관리', reason: `${NAV_ORGBIZ} — 단어표의 큰 탭 자리('#tab') 값` },
].map(Object.freeze));
