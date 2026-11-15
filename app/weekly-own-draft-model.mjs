// WEEKLY-내양식자유변형 ④-1(시안 docs/design/mockups/weekly-own-form.html ③): '내 양식' 그대로 그 주 초안 모양 만들기(화면·서버 없는 순수 함수).
// 항목마다 고른 '채울 기록'(weekly-own-form-model.mjs FILLS)을 그 주 기록 모델(journal-weekly.js weeklySummary 결과)에서 가져온다.
//  - 표가 없는 항목: 줄 목록('- 11/18 글').  - 표가 있는 항목: 기록 하나 = 줄 하나, 칸 이름을 규칙으로 맞춤(날짜·장소·이름·내용, 나머지는 빈칸).
//  - 지난주 글 그대로(last_week): 지난주 초안의 같은 항목(id) 줄·행을 그대로(없으면 빈칸). 빈칸(blank): 비움.
//  - filled: 이번 주 기록에서 채운 칸 표시(화면 노란 칸). 기록 내용은 화면·한글 파일에만 쓰고 로그에 쓰지 않는다.
// 다른 팀 양식 규칙(항목 이름·표 칸)은 쓰지 않는다 — 항목·칸은 모두 '내 양식'에서 온다.

export const ROW_MAX = 60; // 항목 하나의 줄·행 상한(화면·한글 파일이 너무 길어지지 않게)
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const dayText = day => (DAY.test(String(day ?? '')) ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : '');
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// 채울 기록 → 그 주 항목 [{day, name, text, place, time}] (모델 모양은 journal-weekly.js weeklySummary).
export function fillItems(fill, model) {
  if (!model) return [];
  const ok = part => part && !part.loading;
  if (fill === 'biz' && ok(model.summary)) {
    const out = [];
    for (const area of model.summary.areas ?? []) for (const row of area.rows ?? []) for (const i of row.items ?? []) out.push({day: i.day, name: area.name, text: i.label ? `${i.label}: ${i.text}` : i.text});
    for (const other of model.summary.others ?? []) for (const i of other.items ?? []) out.push({day: i.day, name: other.name, text: i.text});
    return out;
  }
  if (fill === 'org' && ok(model.orgs)) return (model.orgs.sections ?? []).flatMap(s => (s.items ?? []).map(i => ({day: i.day, name: s.name, text: i.text})));
  if (fill === 'meeting' && ok(model.meetings)) return (model.meetings.items ?? []).map(i => ({day: i.day, name: i.kindName ?? '', text: i.text}));
  if (fill === 'schedule') {
    const cal = model.calendarView ?? model.calendar;
    if (!cal || cal.loading || cal.failed?.length) return [];
    return (cal.rows ?? []).flatMap(row => (row.items ?? []).map(i => ({day: row.day, time: i.time ?? '', text: i.title ?? i.text ?? '', place: i.place ?? ''})));
  }
  if (fill === 'todo') {
    const done = model.tasks && !model.tasks.loading ? model.tasks.items ?? [] : [];
    return done.map(i => ({day: i.day, text: i.text}));
  }
  return [];
}

// 칸 이름 → 넣을 값 종류(규칙). 맞는 말이 없으면 'text'(첫 칸만) 또는 빈칸.
const KIND = [['day', /날짜|일시|일자|^일$|기간|요일/], ['place', /장소|곳|위치/], ['name', /이름|조직|지회|지부|분회|사업장|단위|사업명|영역|구분|회의/], ['text', /내용|동향|현황|결과|진행|활동|일정|제목|비고|계획/]];
export function columnKinds(columns) {
  const kinds = columns.map(c => (KIND.find(([, re]) => re.test(c)) ?? [''])[0]);
  // '비고'는 맞더라도 뒤쪽 빈칸으로 둔다. 내용 칸이 없으면 이름도 날짜도 아닌 첫 칸을 내용으로.
  columns.forEach((c, i) => { if (/비고/.test(c)) kinds[i] = ''; });
  const firstText = kinds.indexOf('text');
  kinds.forEach((k, i) => { if (k === 'text' && i !== firstText) kinds[i] = ''; });
  if (firstText < 0) { const i = kinds.findIndex(k => k === ''); if (i >= 0 && !columns[i].match(/비고/)) kinds[i] = 'text'; }
  return kinds;
}
const cellOf = (item, kind) => (kind === 'day' ? [dayText(item.day), item.time].filter(Boolean).join(' ') : kind === 'place' ? clean(item.place) : kind === 'name' ? clean(item.name) : kind === 'text' ? clean(item.text) : '');

// form: cleanForm 결과, model: weeklySummary 결과, last: 지난주 초안({sections:[{id, lines?, rows?}]}) 또는 null.
// → {sections:[{id, title, level, columns, fill, lines:[{text, filled}]|null, rows:[[{text, filled}]]|null}]}
export function ownDraft(form, model, last = null) {
  const lastOf = new Map((last?.sections ?? []).map(s => [s.id, s]));
  return {sections: (form?.sections ?? []).map(s => {
    const base = {id: s.id, title: s.title, level: s.level, columns: s.columns, fill: s.fill};
    if (s.fill === 'last_week') {
      const prev = lastOf.get(s.id);
      if (s.columns.length) return {...base, lines: null, rows: (prev?.rows ?? []).slice(0, ROW_MAX).map(r => s.columns.map((_, i) => ({text: clean(r[i]?.text ?? r[i] ?? ''), filled: false})))};
      return {...base, lines: (prev?.lines ?? []).slice(0, ROW_MAX).map(l => ({text: clean(l?.text ?? l), filled: false})), rows: null};
    }
    const items = s.fill === 'blank' ? [] : fillItems(s.fill, model).filter(i => clean(i.text)).slice(0, ROW_MAX);
    if (s.columns.length) {
      const kinds = columnKinds(s.columns);
      return {...base, lines: null, rows: items.map(i => kinds.map(k => { const text = cellOf(i, k); return {text, filled: !!text}; }))};
    }
    return {...base, lines: items.map(i => ({text: `- ${[dayText(i.day), clean(i.text)].filter(Boolean).join(' ')}`, filled: true})), rows: null};
  })};
}

// ── ④-2 화면 고침(시안 ③ '칸 눌러 수정'): 고친 항목만 서버(app_weekly_own_drafts.sections)에 통째로 둔다.
// 저장 모양 [{id, lines:[글]|null, rows:[[글]]|null}] — 글만(채움 표시·양식 글자 없음). 고친 항목은 이번 주 기록이 늦게 와도 덮지 않는다.
// 다음 주 '지난주 글 그대로'(ownDraft last)도 이 모양을 그대로 읽는다.
export const LINE_MAX = 500, CELL_MAX = 300, SAVED_MAX = 200; // 서버 CHECK: 항목 200개·200000바이트
const cut = (s, max) => clean(s).slice(0, max);
export function cleanSaved(sections) {
  const seen = new Set(), out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    const id = typeof s?.id === 'string' ? s.id.slice(0, 40) : '';
    if (!id || seen.has(id) || out.length >= SAVED_MAX) continue;
    seen.add(id);
    const lines = Array.isArray(s.lines) ? s.lines.map(l => cut(l?.text ?? l, LINE_MAX)).filter(Boolean).slice(0, ROW_MAX) : null;
    const rows = Array.isArray(s.rows) ? s.rows.filter(Array.isArray).slice(0, ROW_MAX).map(r => r.slice(0, 12).map(c => cut(c?.text ?? c, CELL_MAX))) : null;
    out.push({id, lines: rows ? null : lines ?? [], rows});
  }
  return out;
}

// 그 항목 재료가 아직 오는 중인지(화면이 그 자리에 기다림 표시).
export function fillLoading(fill, model) {
  if (!model) return true;
  const part = {biz: model.summary, org: model.orgs, meeting: model.meetings, schedule: model.calendarView ?? model.calendar, todo: model.tasks}[fill];
  return ['biz', 'org', 'meeting', 'schedule', 'todo'].includes(fill) && !!part?.loading;
}

// 화면에 보일 초안: ownDraft + 고친 항목(saved)은 그 글 그대로(edited, 노란 칸 아님). 칸 수가 바뀐 양식이면 칸 수에 맞춘다.
export function shownDraft(form, model, last = null, saved = []) {
  const own = new Map(cleanSaved(saved).map(s => [s.id, s]));
  const draft = ownDraft(form, model, last);
  return {sections: draft.sections.map(s => {
    const mine = own.get(s.id);
    if (!mine) return {...s, edited: false, loading: s.fill !== 'last_week' && s.fill !== 'blank' && fillLoading(s.fill, model)};
    if (s.columns.length) return {...s, edited: true, loading: false, lines: null, rows: (mine.rows ?? (mine.lines ?? []).map(l => [l])).map(r => s.columns.map((_, i) => ({text: r[i] ?? '', filled: false})))};
    return {...s, edited: true, loading: false, rows: null, lines: (mine.lines ?? (mine.rows ?? []).map(r => r.filter(Boolean).join(' '))).map(text => ({text, filled: false}))};
  })};
}

// 보이는 항목 하나(shownDraft 한 칸)를 고친 뒤의 saved. change: {lines:'여러 줄 글'} | {row, col, text}(row가 끝 다음이면 새 줄)
// 내용이 모두 빈 줄은 뺀다(칸을 비우면 그 줄이 사라진다).
export function editSaved(saved, section, change) {
  const list = cleanSaved(saved).filter(s => s.id !== section.id);
  let next;
  if (section.columns?.length) {
    const rows = (section.rows ?? []).map(r => r.map(c => c.text));
    if (change.row === rows.length) rows.push(section.columns.map(() => ''));
    if (rows[change.row] && change.col >= 0 && change.col < section.columns.length) rows[change.row][change.col] = cut(change.text, CELL_MAX);
    next = {id: section.id, lines: null, rows: rows.filter(r => r.some(Boolean)).slice(0, ROW_MAX)};
  } else {
    const lines = String(change.lines ?? '').split('\n').map(l => cut(l, LINE_MAX)).filter(Boolean).slice(0, ROW_MAX);
    next = {id: section.id, lines, rows: null};
  }
  return cleanSaved([...list, next]);
}

// 다시 그릴지 견주는 열쇠(그 항목이 바뀌었을 때만 그 자리를 다시 그린다).
export const sectionKey = s => JSON.stringify([s.title, s.level, s.columns, s.edited, s.loading, s.lines, s.rows]);

// 지난주 월요일(YYYY-MM-DD).
export function prevWeek(start) {
  if (!DAY.test(String(start ?? ''))) return '';
  const d = new Date(`${start}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
