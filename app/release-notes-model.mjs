// UI-업데이트안내(docs/design/update-notice-release-notes.md 9장, 2026-10-27 명진 결정): "업데이트 기록"의 모양과 계산.
// - 작업 세션이 앱 화면이 바뀐 PR마다 app/release-notes/<날짜>-<시각>-<작업이름>.json 파일 1개를 더한다(PR끼리 충돌 없음).
//   {"date":"2026-10-28","changes":["바뀐 점 한 줄"],"checks":["폰에서 볼 것 한 줄"]}
// - Pages 빌드(scripts/build-pages.mjs)가 그 파일들을 모아 버전명(날짜-그날 순번, 예: 10/28-2)을 붙여 배포물에만 app/release-notes.json을 만든다.
//   DB·Edge·Worker·기기 저장소는 쓰지 않는다. 앱(새 버전 알림·내 프로필 맨 아래 업데이트 기록)은 그 파일 하나만 읽는다.
// - 공개 배포물이라 누구나 읽을 수 있다: 일상어 한 줄씩, 업무 내용·이름·주소·키 모양은 넣지 않는다(아래 검사가 모양만 막는다).
// 이 파일은 DOM을 쓰지 않는 순수 함수만 둔다(빌드·검사·앱·단위 시험이 같이 쓴다).

export const NOTE_DIR = 'app/release-notes/';
export const OUTPUT_PATH = 'app/release-notes.json';
export const FILE_RE = /^app\/release-notes\/(\d{4})(\d{2})(\d{2})-([01]\d|2[0-3])([0-5]\d)-[a-z0-9][a-z0-9-]{0,59}\.json$/;
export const LINE_MAX = 100, CHANGES_MAX = 3, CHECKS_MAX = 3, PAGE_SIZE = 20;
const VERSION_RE = /^(1[0-2]|[1-9])\/(3[01]|[12]\d|[1-9])-[1-9]\d{0,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 공개 파일에 들어가면 안 되는 모양(줄 단위). 뜻(업무 내용)은 기계가 못 가리므로 작성 규칙(AGENTS.md §10)에 맡긴다.
const FORBIDDEN = [
  [/[\p{Cc}\p{Cf}]/u, '제어 문자'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, '메일 주소 모양'],
  [/\b(?:https?|ftp):\/\/|\bwww\./i, '인터넷 주소'],
  [/[A-Za-z0-9_-]{32,}/, '긴 영문·숫자 덩어리(키 모양)'],
  [/\b(?:eyJ|sk-|ghp_|gho_|github_pat_|sb_|xox[abp]-)/, '키 머리'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'IP 주소'],
  [/(?:^|\s)(?:\/home\/|\/Users\/|[A-Za-z]:\\)/, '파일 경로'],
  [/\b(?:bearer|authorization|password|passwd|token)\b/i, '인증 낱말'],
  [/[<>]/, '꺾쇠 기호'],
  [/\b(?:RLS|Edge Function|migration|supabase)/i, '개발 용어']
];

export function lineProblem(line) {
  if (typeof line !== 'string') return '글자가 아님';
  const text = line.trim();
  if (!text) return '빈 줄';
  if (text !== line) return '앞뒤 공백';
  if ([...text].length > LINE_MAX) return `${LINE_MAX}자 넘음`;
  for (const [re, why] of FORBIDDEN) if (re.test(text)) return why;
  return '';
}

/** 기록 파일 하나 검사. 돌려주는 값: {note:{date,changes,checks}|null, errors:[...]} */
export function checkNoteFile(path, text) {
  const errors = [], m = FILE_RE.exec(path);
  if (!m) return { note: null, errors: [`${path}: 파일 이름은 app/release-notes/YYYYMMDD-HHMM-작업이름.json (소문자 영문·숫자·-)`] };
  let data;
  try { data = JSON.parse(typeof text === 'string' ? text : Buffer.from(text).toString('utf8')); } catch { return { note: null, errors: [`${path}: JSON이 아님`] }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { note: null, errors: [`${path}: 객체가 아님`] };
  for (const key of Object.keys(data)) if (!['date', 'changes', 'checks'].includes(key)) errors.push(`${path}: 모르는 칸 ${key}`);
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (data.date !== date) errors.push(`${path}: date는 파일 이름 날짜(${date})와 같아야 함`);
  const lines = (key, min, max) => {
    const list = data[key] ?? [];
    if (!Array.isArray(list) || list.length < min || list.length > max) { errors.push(`${path}: ${key}는 ${min}~${max}줄`); return []; }
    list.forEach((line, i) => { const why = lineProblem(line); if (why) errors.push(`${path}: ${key}[${i}] ${why}`); });
    return list;
  };
  const changes = lines('changes', 1, CHANGES_MAX), checks = lines('checks', 0, CHECKS_MAX);
  return errors.length ? { note: null, errors } : { note: { date, changes: [...changes], checks: [...checks] }, errors };
}

/**
 * 기록 파일들([경로, 내용])을 모아 버전명을 붙인다. 파일 이름(날짜-시각) 순서가 곧 순번이다.
 * 맞지 않는 파일은 빼고 errors에 적는다(빌드는 그래도 진행, 검사·단위 시험이 막는다).
 * 돌려주는 값: {notes: 최신 먼저 [{v,date,changes,checks}], errors}
 */
export function collectNotes(entries) {
  const errors = [], ordered = [];
  for (const [path, text] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const { note, errors: found } = checkNoteFile(path, text);
    errors.push(...found);
    if (note) ordered.push(note);
  }
  const perDay = new Map(), notes = [];
  for (const note of ordered) {
    const n = (perDay.get(note.date) || 0) + 1; perDay.set(note.date, n);
    const [, mm, dd] = note.date.split('-');
    notes.push({ v: `${Number(mm)}/${Number(dd)}-${n}`, ...note });
  }
  return { notes: notes.reverse(), errors };
}

export const isNoteFile = path => path.startsWith(NOTE_DIR) && path.endsWith('.json') && !path.slice(NOTE_DIR.length).includes('/');

/** 배포물 app/release-notes.json 내용(한 줄에 기록 하나). */
export function buildReleaseNotes(entries) {
  const { notes } = collectNotes(entries);
  const lines = notes.map(note => JSON.stringify(note));
  return `{"schema":1,"current":${JSON.stringify(notes[0]?.v ?? null)},"notes":[\n${lines.join(',\n')}\n]}\n`;
}

const okLines = (list, min, max) => Array.isArray(list) && list.length >= min && list.length <= max && list.every(line => !lineProblem(line));
/** 앱이 받은 JSON을 믿을 수 있는 모양으로. 맞지 않으면 null(앱은 지금 알림 그대로). 기록 하나가 틀리면 그것만 뺀다. */
export function parseReleaseNotes(value) {
  if (!value || typeof value !== 'object' || value.schema !== 1 || !Array.isArray(value.notes)) return null;
  const notes = value.notes.filter(n => n && typeof n === 'object' && typeof n.v === 'string' && VERSION_RE.test(n.v)
    && typeof n.date === 'string' && DATE_RE.test(n.date) && okLines(n.changes, 1, CHANGES_MAX) && okLines(n.checks ?? [], 0, CHECKS_MAX))
    .map(n => ({ v: n.v, date: n.date, changes: [...n.changes], checks: [...(n.checks ?? [])] }));
  const current = typeof value.current === 'string' && notes.some(n => n.v === value.current) ? value.current : notes[0]?.v ?? null;
  return { current, notes };
}

/** 이 화면이 열릴 때 알던 마지막 기록(known) 뒤로 새로 생긴 기록. 알 수 없으면 null. */
export function newSince(list, known) {
  if (!list || !known) return null;
  const at = list.notes.findIndex(note => note.v === known);
  return at < 0 ? null : list.notes.slice(0, at);
}

/** 새 버전 알림 한 줄. 새 기록을 모르면 지금 문구 그대로. */
export function noticeText(newer) {
  if (!newer || !newer.length) return '새 버전이 있어요';
  return newer.length === 1 ? `새 버전: ${newer[0].changes[0]}` : `새 버전 · 바뀐 것 ${newer.length}건`;
}

/** 목록의 날짜 표시(10/28). */
export const shortDate = date => { const [, mm, dd] = date.split('-'); return `${Number(mm)}/${Number(dd)}`; };
