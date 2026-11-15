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
