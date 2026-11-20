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
  { file: 'app/org-name-match.mjs', text: '노조', reason: '사용자가 쓴 조직 이름 맞추기(노동조합→노조 줄임 비교), 화면에 안 나옴' },
  { file: 'app/org-dispute-stage-model.mjs', reason: '겸용: 처음 열 때 DB에 넣는 기본 단계 이름(이후 사용자 글). 노조 전용 구조라 기록+에서 끌지 명진 결정 필요' },

  // ── 묶음 C 끝 ──


  // ── 묶음 D ──

  // ── 묶음 D 끝 ──
].map(Object.freeze));
