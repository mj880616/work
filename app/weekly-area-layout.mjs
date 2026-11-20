// S67-30 WEEKLY-칸빼기합치기(요청함 11/20 13:06 "주간보고에서 칸 삭제 가능하게 / 궤도 공동투쟁, 민자철도 사업은 철도지하철협의회 안에 들어가야"):
// [주간 정리] 2. 1) 사업요약표의 사업영역 줄을 주간보고에서만 빼거나(hide) 다른 사업영역 칸 안으로 넣는다(into).
// - 사업영역(app_spaces)·지금 상황(app_business_now)·사업 기록은 바꾸지 않는다. 주간보고 모양만 바뀐다.
// - 저장 자리 = 그 주 임시저장 draft.places(WEEKLY-사업영역묶음 ①-b '고른 자리'와 같은 칸, 서버). 다음 주는 가장 가까운 지난주 값을 이어 쓴다.
//   places.map['<사업영역 이름>'] = {area, task, hide?:true, into?:'<넣을 사업영역 이름>'} — area·task(고른 자리)는 그대로 두고 표시만 더한다.
// - 화면 표(weekly-summary-table.js)와 한글 파일 줄(fileRows → journal-hwpx.js applyBizWindow)이 이 한 곳(layoutAreas)으로 같은 모양을 만든다.

const squash = v => String(v ?? '').replace(/[\s·ㆍ・.,/\-_()[\]]/g, '').toLowerCase();
export const sameArea = (a, b) => !!squash(a) && squash(a) === squash(b);

// places(readPlaces 결과 또는 그 map, 없으면 null) → {hide:[이름], into:Map(이름 → 넣을 이름)}.
export function areaLayout(places) {
  const out = {hide: [], into: new Map()};
  const raw = places?.map && typeof places.map === 'object' ? places.map : places; // places 전체 또는 그 map
  const map = raw && typeof raw === 'object' ? raw : null;
  if (!map) return out;
  for (const [name, v] of Object.entries(map)) {
    if (!v || typeof v !== 'object') continue;
    if (v.hide === true) out.hide.push(name);
    else if (typeof v.into === 'string' && v.into.trim() && !sameArea(v.into, name)) out.into.set(name, v.into.trim());
  }
  return out;
}
export const isHidden = (layout, name) => !!layout?.hide?.some(n => sameArea(n, name));
export const intoOf = (layout, name) => { for (const [k, v] of layout?.into ?? []) if (sameArea(k, name)) return v; return ''; };
// 주간보고에 자기 줄로 나오지 않는 사업영역(뺀 것·다른 칸 안으로 넣은 것) — 한글 파일 상자가 '빈 내 줄'을 더하지 않게.
export const outOfReport = (layout, name) => isHidden(layout, name) || !!intoOf(layout, name);

// areas = fullTable 결과([{id, name, rows:[{task:{id,name}|null, items, …}]}]) 화면 순서.
// 돌려주는 값: {areas: 보이는 사업영역(넣은 사업영역 줄은 받는 사업영역 줄 끝에 '세부 과제'처럼 붙음), hidden:[{id, name}], moved:[{id, name, into}]}.
// 넣은 사업영역 줄: 자기 칸 = 세부 과제 이름 '사업영역 이름', 세부 과제 칸 = '사업영역 이름 · 세부 과제 이름'(칸 id = 원래 id, 지금 상황 그대로).
// 받는 사업영역이 없거나(보관 등)·빠졌거나·그 자신도 다른 칸으로 들어갔으면 넣지 않고 제자리에 둔다(꼬이지 않게 한 단계만).
export function layoutAreas(areas, layout) {
  const list = Array.isArray(areas) ? areas : [];
  if (!layout || (!layout.hide?.length && !layout.into?.size)) return {areas: list, hidden: [], moved: []};
  const hidden = [], moved = [], keep = [];
  for (const a of list) if (isHidden(layout, a.name)) hidden.push({id: a.id, name: a.name}); else keep.push(a);
  const target = a => {
    const to = intoOf(layout, a.name);
    if (!to) return null;
    const t = keep.find(x => x !== a && sameArea(x.name, to));
    return t && !intoOf(layout, t.name) ? t : null;
  };
  const out = keep.map(a => ({...a, rows: [...a.rows]}));
  const shown = [];
  keep.forEach((a, i) => {
    const t = target(a);
    if (!t) { shown.push(out[i]); return; }
    const dest = out[keep.indexOf(t)];
    // 넣는 사업영역 자기 칸(세부 과제만 있던 곳도 — 묶음 표·한글 파일은 사업영역 자기 칸 글을 쓴다)을 먼저, 그 아래 세부 과제.
    const rows = a.rows.some(r => !r.task) ? a.rows : [{task: null, items: [], folded: [], dropped: []}, ...a.rows];
    for (const r of rows) {
      const name = r.task ? `${a.name} · ${r.task.name || ''}` : a.name;
      dest.rows.push({...r, task: {id: r.task ? r.task.id : a.id, name}, movedFrom: a.name});
    }
    moved.push({id: a.id, name: a.name, into: t.name});
  });
  return {areas: shown, hidden, moved};
}
