// FILES-최근자동제외(S51-23, 요청함 11/06 21:29): 파일 '최근' 상자에서 Web2 자동화가 되풀이해 만드는 파일을 뺀다.
// - 판별은 파일 이름이 아니라 그 파일이 들어 있는 시스템 폴더(위 폴더 이름 줄)로 한다. 서버 app_cloud_find_in이 주는
//   folder_path('맨 위 › … › 바로 위 폴더')를 ' › '로 잘라 아래 규칙과 맞춘다. 이름 모양(숫자.json 등)은 보지 않는다.
// - '최근'에서만 뺀다. 파일 자체·폴더 보기·찾기·별표·큰 파일에는 그대로 보인다(삭제·숨김 아님, 데이터 그대로).
// - 거르기 목록은 이 파일 한 곳에만 둔다. 화면은 '최근' 상태를 만드는 곳(files.js loadRecent) 한 곳에서만 부른다.
// - 폴더 이름은 각 자동화 코드의 상수와 같다(바뀌면 여기도 고친다, tests/files-auto-model.test.mjs가 대조한다).
//   노트·자료실 '최근'은 사람이 넣은 것만 쌓여(되풀이 자동 생성 없음) 거를 것이 없다.

// 규칙 하나 = 폴더 이름 줄(seq). 칸은 이름(글자 그대로) 또는 RegExp(이름 모양). adjacent면 바로 이어진 폴더여야 하고,
// 아니면 그 순서로 위아래에 있기만 하면 된다. 그 폴더 아래(더 깊은 폴더 포함)의 파일이 모두 해당한다.
// 방 폴더 모양: 수집기가 만드는 '<대화방 숫자 id>_<방 이름>'(docs/design/call-telegram-feed.md 1.1절). 텔레그램 id는 5자리 이상이라
// '2026_자료' 같은 사람 폴더(연도 4자리)와 가른다.
const TG_ROOM_FOLDER = /^-?\d{5,}_./;
export const AUTO_FOLDER_RULES = Object.freeze([
  // 회사 PC 텔레그램 수집기: <수집 폴더>/원문/<방 폴더>/…(messages/<YYYY-MM>/메시지 json, 첨부 사진, room.json)
  //   — docs/ops/collector-feed.gs TG_FEED_RAW_FOLDER·TG_FEED_MESSAGES_FOLDER
  Object.freeze({key: 'telegram', seq: Object.freeze(['원문', TG_ROOM_FOLDER]), adjacent: true}),
  // 같은 수집기가 30분마다 만드는 검토후보 표(call-telegram-feed.md 1.1절·Q9)
  Object.freeze({key: 'telegram_candidates', seq: Object.freeze(['검토후보']), adjacent: true}),
  // 통화 전사 스크립트: 통화 녹음/전사/…(전사 txt) — collector-feed.gs CALL_FEED_TRANSCRIPT_FOLDER
  Object.freeze({key: 'call_transcript', seq: Object.freeze(['통화 녹음', '전사']), adjacent: true}),
  // 통화 분석 스크립트 결과(통화 녹음 폴더 옆 검토대기·검토완료) — collector-feed.gs CALL_FEED_ANALYSIS_FOLDERS
  Object.freeze({key: 'call_analysis', seq: Object.freeze(['검토대기']), adjacent: true}),
  Object.freeze({key: 'call_analysis', seq: Object.freeze(['검토완료']), adjacent: true}),
  // Claude용 읽기 사본·원장 백업(drive-summary 정기 갱신) — drive-summary/core.mjs
  Object.freeze({key: 'drive_summary', seq: Object.freeze(['Web2 읽기용 사본']), adjacent: true}),
  // 한글 문서 고칠 때마다 남는 편집 전 백업 — _shared/hwp-edit.ts BACKUP_FOLDER
  Object.freeze({key: 'edit_backup', seq: Object.freeze(['Web2 편집 백업']), adjacent: true}),
  // 회의 녹음을 나눠 올린 조각(전사용) — meeting-transcribe/index.ts RECORDING_FOLDER, recording.mjs PIECE_FOLDER
  Object.freeze({key: 'recording_pieces', seq: Object.freeze(['회의 녹음', '녹음 조각']), adjacent: true}),
  // 사진·파일에서 지운 것을 옮겨 두는 Web2 휴지통 — photos-model.mjs TRASH_FOLDER_NAME
  Object.freeze({key: 'trash', seq: Object.freeze(['.Web2 휴지통']), adjacent: true}),
]);

export const PATH_SEP = ' › ';
const segments = path => typeof path === 'string' && path ? path.split(PATH_SEP).map(s => s.trim()).filter(Boolean) : [];

const same = (name, want) => (want instanceof RegExp ? want.test(name) : name === want);
function matches(segs, {seq, adjacent}) {
  if (adjacent) {
    for (let i = 0; i + seq.length <= segs.length; i++) if (seq.every((n, k) => same(segs[i + k], n))) return true;
    return false;
  }
  let k = 0;
  for (const s of segs) if (same(s, seq[k]) && ++k === seq.length) return true;
  return false;
}

// 이 줄이 자동화가 만든 파일인가(어느 규칙인지 key, 아니면 null). 폴더 위치를 모르면(folder_path 없음) 자동으로 보지 않는다.
export function autoMadeKind(row) {
  const segs = segments(row?.folder_path);
  if (!segs.length) return null;
  for (const rule of AUTO_FOLDER_RULES) if (matches(segs, rule)) return rule.key;
  return null;
}
export const isAutoMade = row => autoMadeKind(row) !== null;

// '최근' 상자에 넣을 줄: 자동 생성 파일을 빼고 앞에서 limit줄. 서버 순서(최근 바뀐 순)는 그대로.
export function recentHumanRows(rows, limit) {
  const list = (Array.isArray(rows) ? rows : []).filter(r => !isAutoMade(r));
  return Number.isFinite(limit) ? list.slice(0, Math.max(0, limit)) : list;
}
