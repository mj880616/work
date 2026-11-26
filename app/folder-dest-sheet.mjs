// S69-62 폴더 고르기 창 하나(사용자 11/24 18:16 "파일 옮기는 UI는 지금 파일 메뉴에서 사용하는 게 제일 좋아. 이거를 다른 데서도 사용할 수 있도록"):
// [파일]의 '옮길 곳' 창(아래에서 올라오는 창 — 위 '최근 보낸 곳' 칩, 폴더 나무(누르면 펼침·선택, 하위 들여쓰기), 아래 줄 경로 + [새 폴더] + [여기에 옮기기])의
// 모양 한 곳. [파일](files.js)은 이 HTML을 그대로 쓰고, 자료실·노트·사진·조직 기록·News 별표 폴더는 folder-dest-sheet.js(같은 모양의 창 주인)를 쓴다.
// 순수 함수만(화면·저장소·네트워크에 닿지 않음, node --test로 시험). 모양 규칙은 folder-dest-sheet.css 한 곳.
//  - 줄을 누르면 고르기 + 펼치기(누르기만으로는 옮기지 않는다). 옮기기는 아래 [여기에 옮기기]로만.
//  - 폴더 아이콘 단추는 펼치기·접기만. 맨 위 줄(자료실·내 드라이브 등)은 저장소 그림.
export const ROOT = '__root__';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 창 HTML 하나. 줄(rows)은 부른 쪽이 공용 줄(folder-tree-ui.mjs ftFolderRowHtml)로 만든 HTML 문자열이다.
//  title: 창 이름('1개 옮길 곳'), chips: [{key, name, icon(HTML), on}] — '최근 보낸 곳', tree: 줄 HTML(없으면 기다림 표시 wait),
//  slot: 나무 아래 끼우는 HTML(같은 이름 묻기 등), at: 아래 줄 경로 글('구글 드라이브 › 연극 대본') — 없으면 '받을 폴더를 선택하세요',
//  canMk: [새 폴더] 누를 수 있나(mk:false면 단추 없음), canGo: [goLabel] 누를 수 있나, note: 나무 위 한 줄 안내(없으면 없음),
//  extra: [새 폴더] 옆 단추 하나의 글(자료실 나누기 창의 '새 폴더 제안'처럼 창을 닫고 부른 쪽이 따로 하는 일, 없으면 없음).
export function destSheetHtml({title, titleId = 'fxDestTitle', chips = [], chipsLabel = '최근 보낸 곳', tree = '', wait = '', slot = '', at = '', canMk = false, mk = true, canGo = false, goLabel = '여기에 옮기기', note = '', treeLabel = '받을 곳 폴더', extra = ''}) {
  const recent = chips.length ? `<div class="fx-dest-sub">${esc(chipsLabel)}</div><div class="fx-dest-recent">${chips.map(c =>
    `<button type="button" class="fx-dest-chip${c.on ? ' on' : ''}" data-fx-dest-pick="${esc(c.key)}" data-fx-dest-name="${esc(c.name)}">${c.icon || ''}<span>${esc(c.name)}</span></button>`).join('')}</div>` : '';
  return `<div class="fx-dest-h"><span id="${esc(titleId)}">${esc(title)}</span><button type="button" class="mini" data-fx-dest-close aria-label="닫기">✕</button></div>`
    + recent + (note ? `<p class="fx-dest-note">${esc(note)}</p>` : '')
    + `<nav class="fx-dest-tree nx-tree" aria-label="${esc(treeLabel)}">${tree || wait}</nav>`
    + slot
    + `<div class="fx-dest-f"><span class="fx-dest-at">${at ? esc(at) : '받을 폴더를 선택하세요'}</span>`
    + (mk ? `<button type="button" class="fx-btn" data-fx-dest-mkdir${canMk ? '' : ' disabled'}>새 폴더</button>` : '')
    + (extra ? `<button type="button" class="fx-btn" data-fd-extra>${esc(extra)}</button>` : '')
    + `<button type="button" class="fx-btn fx-pri" data-fx-dest-go${canGo ? '' : ' disabled'}>${esc(goLabel)}</button></div>`;
}

// 창 이름: '1개 옮길 곳' · '3개 옮길 곳' · '받는 폴더 고르기' 같은 것. n이 없으면 what만.
export const sheetTitle = (n, what = '옮길 곳') => (Number.isInteger(n) && n > 0 ? `${n}개 ${what}` : what);

// 납작한 폴더 목록(id·name·parent_id·sort_order·color) → 형제 순서. sort_order가 숫자면 그 순서, 같으면 받은 순서(이름 순서로 바꾸지 않는다).
function kidsOf(list) {
  const by = new Map();
  list.forEach((f, i) => {
    const p = f.parent_id && list.some(x => x.id === f.parent_id) ? f.parent_id : null;
    if (!by.has(p)) by.set(p, []);
    by.get(p).push({f, i});
  });
  for (const arr of by.values()) arr.sort((a, b) => {
    const x = Number.isFinite(Number(a.f.sort_order)) ? Number(a.f.sort_order) : Infinity, y = Number.isFinite(Number(b.f.sort_order)) ? Number(b.f.sort_order) : Infinity;
    return x === y ? a.i - b.i : x - y;
  });
  return by;
}

// 나무 줄: 맨 위 줄(ROOT, rootName) 아래 펼친 폴더의 하위만. open: 펼친 키 Set(ROOT 포함).
//  maybeKids(id): 아직 안 읽은 층(사진 구글 드라이브처럼 한 층씩 읽는 곳)은 true를 돌려주면 펼칠 수 있게 그린다.
//  돌려줌: [{key, id, name, depth, open, hasKids, color, root}]. 맨 위 줄 depth 0, 그 아래 1부터.
export function folderSheetRows({folders = [], open = new Set(), rootName = '', showRoot = true, maybeKids = null}) {
  const list = (Array.isArray(folders) ? folders : []).filter(f => f && typeof f.id === 'string' && f.id);
  const by = kidsOf(list), out = [], seen = new Set();
  const kidsAt = id => by.get(id) || [];
  const hasKids = id => kidsAt(id).length > 0 || !!maybeKids?.(id);
  const rootOpen = !showRoot || open.has(ROOT);
  if (showRoot) out.push({key: ROOT, id: null, name: rootName, depth: 0, open: rootOpen, hasKids: kidsAt(null).length > 0 || !!maybeKids?.(null), color: null, root: true});
  const walk = (parent, depth) => {
    for (const {f} of kidsAt(parent)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const isOpen = open.has(f.id), kids = hasKids(f.id);
      out.push({key: f.id, id: f.id, name: String(f.name ?? ''), depth, open: isOpen, hasKids: kids, color: f.color ?? null, root: false, off: !!f.off});
      if (isOpen) walk(f.id, depth + 1);
    }
  };
  if (rootOpen) walk(null, showRoot ? 1 : 0);
  return out;
}

// 어떤 폴더까지의 위 폴더들(가까운 것이 끝). 고른 폴더가 보이게 처음 펼칠 때 쓴다. 고리(잘못된 parent)는 40단에서 멈춘다.
export function folderChain(folders, id) {
  const byId = new Map((folders || []).filter(f => f?.id).map(f => [f.id, f]));
  const out = [];
  for (let cur = byId.get(id), guard = 0; cur && guard < 40; guard++) {
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return out;
}

// 아래 줄 경로 글: '자료실 › 가 › 나'. 길면 가까운 5단만(앞은 '…').
export function folderSheetPath(folders, key, rootName) {
  if (key === ROOT || key === null || key === undefined) return rootName || '';
  const chain = folderChain(folders, key).map(f => String(f.name ?? ''));
  if (!chain.length) return rootName || '';
  const near = chain.length > 5 ? ['…', ...chain.slice(-5)] : chain;
  return [rootName, ...near].filter(Boolean).join(' › ');
}

// 이 폴더와 그 아래 모두(폴더를 자기 안으로 옮기지 않게). 돌려줌: id Set.
export function folderAndBelow(folders, id) {
  const out = new Set(id ? [id] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders || []) if (f?.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}
