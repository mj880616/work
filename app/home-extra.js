import {waitHtml} from './wait-state.js';
// MENU-HOME-편집: 홈에 새로 더할 수 있는 칸(자주 가는 링크 · 노트 최근 · 최근 자료)의 유일한 renderer.
// 모두 owner RLS REST 읽기뿐(새 RPC·Edge 없음). 홈에 들어와 있을 때만 읽는다(home-read.js가 칸이 홈에 있을 때 mount한다).
// 칸 틀: 칸 하나 = {title, goto, read(rt) → 줄 목록, rowHtml}. 새 칸은 이 표에 한 줄을 더하고 home-cards-model.mjs CARDS에 이름을 더하면 된다.
import {readLinks} from './quick-links.js';
import {titleOf} from './home-cards-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ws = rt => rt?.context?.read?.()?.workspace?.id || '';
const day = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()}`; };
const LIMIT = 5;

export const EXTRA = Object.freeze({
  links: {
    goto: '', empty: '링크 없음',
    async read(rt) { const out = await readLinks(rt); return out.status === 'ok' ? out.links.slice(0, 12) : null; },
    html: rows => `<div class="home-chips">${rows.map(link => `<a class="home-chip" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(link.url)}">${esc(link.name)}</a>`).join('')}</div>`
  },
  notes: {
    goto: 'basket', label: '노트', empty: '노트 없음',
    async read(rt) {
      const id = ws(rt); if (!id) return null;
      const rows = await rt.api(`/rest/v1/app_notes?workspace_id=eq.${encodeURIComponent(id)}&kind=eq.note&select=id,title,updated_at&order=updated_at.desc,id.desc&limit=${LIMIT}`, {singleFlight: false});
      return Array.isArray(rows) ? rows : null;
    },
    html: rows => rows.map(row => `<button type="button" class="home-extra-row" data-home-note="${esc(row.id)}"><span class="home-title">${esc(row.title || '제목 없음')}</span><small>${esc(day(row.updated_at))}</small></button>`).join('')
  },
  docs: {
    goto: 'library', label: '자료실', empty: '자료 없음',
    async read(rt) {
      const id = ws(rt); if (!id) return null;
      const rows = await rt.api(`/rest/v1/app_documents?workspace_id=eq.${encodeURIComponent(id)}&select=id,title,created_at&order=created_at.desc,id.desc&limit=${LIMIT}`, {singleFlight: false});
      return Array.isArray(rows) ? rows : null;
    },
    html: rows => rows.map(row => `<button type="button" class="home-extra-row" data-goto="library"><span class="home-title">${esc(row.title || '제목 없음')}</span><small>${esc(day(row.created_at))}</small></button>`).join('')
  }
});

// 칸 하나를 만든다. el은 home-read.js가 홈에 붙이는 <section>. 읽기는 refresh()가 하고, 실패하면 한 줄로 알린다.
export function createExtraCard(id, {rt = window.KPTURuntime} = {}) {
  const spec = EXTRA[id];
  if (!spec) return null;
  const el = document.createElement('section');
  el.className = 'home-card home-extra'; el.dataset.homeCard = id; el.setAttribute('aria-labelledby', `home-${id}-title`);
  const head = `<header><h3 id="home-${id}-title">${esc(titleOf(id))}</h3>${spec.goto ? `<button type="button" data-goto="${spec.goto}">${esc(spec.label)} ›</button>` : ''}</header>`;
  const body = text => { el.innerHTML = `${head}<div data-home-body>${text}</div>`; };
  body(waitHtml({rows:3}));
  let run = 0;
  async function refresh() {
    const mine = ++run;
    try {
      const rows = await spec.read(rt);
      if (mine !== run) return;
      body(rows === null ? '<p class="home-status">불러오지 못했어요</p>' : rows.length ? spec.html(rows) : `<p class="home-status">${spec.empty}</p>`);
    } catch { if (mine === run) body('<p class="home-status">불러오지 못했어요</p>'); }
  }
  // 노트 줄: 노트 쪽 정리함에서 그 노트를 연다(메뉴의 [노트]와 같은 길).
  el.addEventListener('click', async event => {
    const button = event.target.closest('[data-home-note]');
    if (!button) return;
    try {
      const {requestBasketKind, requestNoteDocOpen} = await import('./basket-note-tasks.js');
      requestBasketKind('note'); requestNoteDocOpen(button.dataset.homeNote);
    } catch (error) { console.error('home note', error); }
    window.KPTURouter?.go('basket', {source: 'delegated'});
  });
  return {el, refresh, destroy() { run++; }};
}
