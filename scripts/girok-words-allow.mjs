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
  { file: 'app/activity-photo-model.mjs', text: '교섭', reason: '자료실 종류 이름 맞추기(데이터 값, 화면에는 자료실 종류로 보임)' },
  { file: 'app/activity-photo-model.mjs', text: '투쟁', reason: '자료실 종류 이름 맞추기(데이터 값)' },
  { file: 'app/ask-web2-model.mjs', text: '교섭·전략', reason: '서버 답의 꼬리표 값 비교(데이터 값)' },
  { file: 'app/journal-draft-model.mjs', text: '조직 소식', reason: 'AI 초안 재료 줄 꼬리표(서버로 보내는 글, 화면에 안 보임)' },
  { file: 'app/weekly-major-schedule.mjs', reason: '노조식 주간 보고 주요 일정 기준: AI 지시문·사용자 일정 이름 맞추기 단어(기록+에서 끌지 명진 결정 필요)' },
  { file: 'app/weekly-group-names.mjs', text: '현황', reason: "서버 사본(supabase/functions/_shared/weekly-group-names.mjs)과 바이트까지 같아야 해 brand를 부를 수 없음. 양식 제목이 없을 때만 쓰는 기본 묶음 이름 '사업장 현황'·'조직 현황' — 주간 보고 학습 묶음(노조식 주간 보고와 함께 명진 결정)" },
  { file: 'app/journal.js', text: "'노조 서식'", reason: "자료실 분류 이름 '노조 서식'(데이터 값 hwp-drive.js UNION_TEMPLATE_CATEGORY)을 가리키는 글 — 분류 이름과 함께 정할 겸용 값" },

  // ── 묶음 B 끝 ──


  // ── 묶음 C ──

  // ── 묶음 C 끝 ──


  // ── 묶음 D ──

  // ── 묶음 D 끝 ──
].map(Object.freeze));
