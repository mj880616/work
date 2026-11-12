// UX-이미있는파일알림(요청함 11/12 09:39): 같은 이름·같은 크기 파일이 내 작업공간 어디에 이미 있는지 보는 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 찾는 일(서버 읽기)과 묻는 창은 same-file.js가 한다. 여기서는 열쇠·서버 읽기 주소 조각·위치 한 줄·답에 따른 나누기만 정한다.
export const SAME_MAX = 20;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

// 같은 파일인지 보는 열쇠: 이름(한글 자모 조합 차이는 같게 NFC) + 바이트 크기. 크기가 0이거나 모르면 열쇠 없음(찾지 않음).
export function sameKey(name, size) {
  const n = String(name ?? '').normalize('NFC');
  const s = Number(size);
  return n && Number.isSafeInteger(s) && s > 0 ? `${n}\u0000${s}` : '';
}

// 찾을 파일들(열쇠가 있는 것만, 같은 열쇠는 한 번, 20개까지).
export function sameTargets(files) {
  const out = [], seen = new Set();
  for (const f of files || []) {
    const name = String(f?.name ?? '').normalize('NFC'), size = Number(f?.size);
    const key = sameKey(name, size);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push({name, size, key});
    if (out.length >= SAME_MAX) break;
  }
  return out;
}

// PostgREST in.(…) 값 목록: 모든 값을 큰따옴표로 감싸고 안쪽 \ 와 " 는 \ 로 막는다(쉼표·괄호·점이 든 이름도 한 값으로).
export function inList(values) {
  return `(${[...new Set(values.map(v => String(v)))].map(v => `"${v.replace(/[\\"]/g, c => '\\' + c)}"`).join(',')})`;
}

// 노트 첨부(app_notes.attachments jsonb 배열) 안에 같은 이름·크기 한 칸이 있는지 보는 cs 값.
export function noteContains(t) { return JSON.stringify([{file_name: t.name, size_bytes: t.size}]); }

export function shortDay(value) {
  const m = DAY.exec(String(value || ''));
  return m ? `${Number(m[2])}/${Number(m[3])}` : '';
}

// 위치 한 줄: '자료실 › 예시 폴더 › 예시 보도자료.hwp · 11/11'.
export function placeLine({area = '', where = '', name = '', at = ''} = {}) {
  const head = [area, where, name].map(v => String(v || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' › ');
  const day = shortDay(at);
  return day ? `${head} · ${day}` : head;
}

const NOTE_AREA = {basket: '정리함', note: '노트'};
// 서버에서 읽은 줄 → 찾은 곳 하나 {key, line, kind, ref}. names: {folders: Map(document_id → 폴더 이름), meetings: Map, orgs: Map}.
export function docHit(d, names = {}) {
  const name = d.file_name || d.title || '';
  let area = '자료실', where = names.folders?.get(d.id) || '';
  if (d.meeting_id) { area = '사업 보고'; where = names.meetings?.get(d.meeting_id) || ''; }
  else if (d.organization_id && !where) { area = '담당조직'; where = names.orgs?.get(d.organization_id) || ''; }
  return {key: sameKey(d.file_name, d.file_size), kind: 'document', ref: d, line: placeLine({area, where, name, at: d.created_at})};
}
export function noteHits(n, t) {
  const area = NOTE_AREA[n.kind] || '기록';
  const title = String(n.title || '').trim();
  return {key: t.key, kind: 'note', ref: n, line: placeLine({area, where: title, name: t.name, at: n.occurred_at || n.created_at})};
}
export function taskHit(r) {
  return {key: sameKey(r.file_name, r.size_bytes), kind: 'task', ref: r, line: placeLine({area: '할 일 첨부', name: r.file_name, at: r.created_at})};
}

// 파일마다 찾은 곳들(같은 열쇠). hits: [{key,…}] → Map(file → hits[]). 찾은 곳이 없는 파일은 넣지 않는다.
export function matchFiles(files, hits) {
  const byKey = new Map();
  for (const h of hits || []) { if (!h?.key) continue; if (!byKey.has(h.key)) byKey.set(h.key, []); const list = byKey.get(h.key); if (!list.some(x => x.line === h.line)) list.push(h); }
  const out = new Map();
  for (const f of files || []) { const list = byKey.get(sameKey(f?.name, f?.size)); if (list?.length) out.set(f, list); }
  return out;
}

// 창에 보일 줄(파일마다 한 줄 — 첫 곳 + '외 N곳').
export function askLines(found) {
  return [...found.values()].map(list => list.length > 1 ? `${list[0].line} 외 ${list.length - 1}곳` : list[0].line);
}

// 답에 따라 나눈다. answer: 'skip'(올리지 않기) · 'use'(있는 것 쓰기) · 그 밖('upload' 그래도 올리기, 또는 고르지 않고 닫음).
// 고르지 않고 닫으면(Esc·바깥 누르기·뒤로가기) 고른 파일을 말없이 빼지 않고 그대로 올린다 — 알림은 알리기만, 빼는 것은 직접 고를 때만.
// 돌려줌: {files: 올릴 파일(같은 것이 없던 것 + 그래도 올리기), used: [{file, hit}], skipped: [File]}. 차례는 처음 고른 차례 그대로.
export function splitByAnswer(files, found, answer) {
  const out = {files: [], used: [], skipped: []};
  for (const f of files || []) {
    const list = found.get(f);
    if (!list) out.files.push(f);
    else if (answer === 'skip') out.skipped.push(f);
    else if (answer === 'use') out.used.push({file: f, hit: list[0]});
    else out.files.push(f);
  }
  return out;
}
