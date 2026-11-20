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
  { file: 'app/record-backup.js', text: '노조+ 백업', reason: "Drive 폴더 이름 겸용: 서버(supabase/functions/record-backup)가 '노조+ 백업' 폴더를 만든다. 기록+ 서버 값이 정해지면 함께 바꿈" },

  // ── 묶음 A 끝 ──


  // ── 묶음 B ──

  // ── 묶음 B 끝 ──


  // ── 묶음 C ──

  // ── 묶음 C 끝 ──


  // ── 묶음 D ──

  // ── 묶음 D 끝 ──
].map(Object.freeze));
