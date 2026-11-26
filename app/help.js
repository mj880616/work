// HELP-메뉴안쓰는법(시안 docs/design/mockups/help-howto.html, 사용자 확정 11/16 10:18 "모두 추천대로"): '쓰는 법' 화면(?view=help). #helpView의 유일한 그리기 주인.
// 입구: 계정 › 쓰는 법('앱 정보' 바로 아래, PC 계정 메뉴 · 폰 [메뉴] 창 계정 줄, S69-71), 각 화면 ⋯ 메뉴 맨 아래 '쓰는 법', 빈 화면 안내 [쓰는 법 보기](help-link.js).
// HELP-머리한줄(S71-33, 사용자 11/26 "맨위 안내멘트 지우고 검색창을 제목줄로 올려 돋보기로"): 화면 위 안내 글·화면 안 찾기 칸 줄은 그리지 않는다.
// 찾기는 맨 위 칸 하나가 겸한다(screen-find.js 등록 — PC 맨 위 줄 칸 '쓰는 법에서 찾기', 폰은 머리 줄 [W] 쓰는 법 · 돋보기 → 누르면 그 자리에 칸).
// 폰(~760px): 묶음별 메뉴 한 줄(누르면 3~4줄 + [○○ 열기]로 펼침, <details>) → 계정 칸('내 기록은 누가 보나'·문의 메일).
// 폴드·PC(761px~): 왼쪽 목차 | 오른쪽 내용. 목차는 그 사람 서버 기능 목록으로 정한다 — 운영자 기능이 없는 사람에게는 운영자 메뉴 줄 자체가 없다(숨김 아님).
// 펼친 줄은 주소(?view=help&topic=…)에만 적는다(새로고침 그 자리, 기기 저장 없음). 글은 help-content.mjs 한 곳, 글자는 textContent로만 넣는다.
import {CONTACT, PRIVACY_URL, TERMS_URL, PRIVACY_LINES, helpGroups, matchTopic, notesFor, shotUrl, topic as helpTopic} from './help-content.mjs';
import {registerScreenFind, refreshScreenFind} from './screen-find.js';
import {takeHelpTopic} from './help-link.js';
import {emptyEl} from './wait-state.js';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
const WIDE = window.matchMedia('(min-width:761px)');
const state = {features: null, query: '', selected: '', painted: false};

function install() {
  if (document.getElementById('helpView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="helpView" class="view-panel hidden" aria-label="쓰는 법"><div class="hp" data-hp-root></div></section>');
}
const root = () => document.querySelector('#helpView [data-hp-root]');

function list(title, items, tag = 'ul') {
  if (!items?.length) return [];
  const box = el(tag, 'hp-ls'); items.forEach(text => box.append(el('li', null, text)));
  return [el('p', 'hp-sub', title), box];
}
// 화면 그림(HELP-그림 S71-33): 지어낸 자료로 띄운 폰 화면 캡처(app/help-shots/, tests/app-e2e/help-shots/capture.mjs). 그림마다 alt 글.
function shots(list) {
  if (!list?.length) return null;
  const box = el('div', 'hp-shots'); box.dataset.hpShots = '';
  for (const s of list) {
    const img = el('img', 'hp-shot'); img.src = shotUrl(s.file); img.alt = s.alt; img.width = 390; img.height = s.h; img.loading = 'lazy'; img.decoding = 'async';
    box.append(img);
  }
  return box;
}
function openButton(t) {
  if (!t.open) return null;
  const b = el('button', 'secondary mini hp-open', `${t.label} 열기 ›`); b.type = 'button'; b.dataset.hpGo = t.open;
  return b;
}
// 첫 문장은 줄의 lead(hp-lead)로 이미 보이므로 상자에는 제공/미제공 두 줄만(같은 문장 두 번 금지).
function privacyNodes(leadShown) {
  const box = el('div', 'hp-privacy'); box.dataset.hpPrivacy = '';
  (leadShown ? PRIVACY_LINES.slice(1) : PRIVACY_LINES).forEach(line => box.append(el('p', null, line)));
  const contact = el('p', 'hp-contact');
  const mail = el('a', null, CONTACT); mail.href = `mailto:${CONTACT}`;
  const pv = el('a', null, '처리방침'); pv.href = PRIVACY_URL; pv.target = '_blank'; pv.rel = 'noopener';
  const tm = el('a', null, '이용 약관'); tm.href = TERMS_URL; tm.target = '_blank'; tm.rel = 'noopener';
  contact.append('문의: ', mail, ' · ', pv, ' · ', tm);
  return [box, contact];
}
// 줄 하나의 내용(폰은 펼친 칸, 넓은 화면은 오른쪽). 앱 내려받기 줄은 기기별 탭을 그 자리에 그린다(app-download-guide.js).
function bodyNodes(t, {withLead = true} = {}) {
  const out = [];
  if (withLead) out.push(el('p', 'hp-lead', t.lead));
  if (t.id === 'privacy') { out.push(...privacyNodes(withLead)); return out; }
  if (t.id === 'appdl') {
    const slot = el('div', 'hp-adg'); out.push(slot);
    void import('./app-download-guide.js').then(m => slot.replaceChildren(m.appGuideEl())).catch(() => { slot.textContent = '안내를 불러오지 못했어요.'; });
    return out;
  }
  const pics = shots(t.shots); if (pics) out.push(pics);
  out.push(...list('이럴 때 쓰세요', t.when), ...list('따라하기', t.steps, 'ol'), ...list('알아 둘 것', notesFor(t, state.features)));
  if (t.links?.length) {
    out.push(el('p', 'hp-sub', '다른 메뉴와 이어지는 곳'));
    const ul = el('ul', 'hp-links'); t.links.forEach(([a, b]) => { const li = el('li'); li.append(el('span', 'hp-chip', a), el('span', 'hp-arrow', '→'), el('span', 'hp-chip', b)); li.children[1].setAttribute('aria-hidden', 'true'); ul.append(li); });
    out.push(ul);
  }
  const go = openButton(t); if (go) out.push(go);
  return out;
}

function groups() {
  return helpGroups(state.features).map(g => ({...g, topics: g.topics.filter(t => matchTopic(t, state.query))})).filter(g => g.topics.length);
}
function drawNarrow(box, gs) {
  const listBox = el('div', 'hp-list'); listBox.dataset.hpList = '';
  for (const g of gs) {
    const sec = el('section', 'hp-group'); sec.append(el('h3', 'hp-gl', g.label));
    for (const t of g.topics) {
      const d = el('details', 'hp-item'); d.dataset.hpTopic = t.id;
      const s = el('summary', 'hp-row'); s.append(el('b', 'hp-name', t.label), el('span', 'hp-short', t.short));
      d.append(s, el('div', 'hp-body'));
      if (t.id === state.selected || state.query) { d.open = true; d.lastChild.append(...bodyNodes(t)); }
      sec.append(d);
    }
    listBox.append(sec);
  }
  box.append(listBox);
}
function drawWide(box, gs) {
  const wrap = el('div', 'hp-split');
  const toc = el('nav', 'hp-toc'); toc.setAttribute('aria-label', '쓰는 법 목차'); toc.dataset.hpToc = '';
  const all = gs.flatMap(g => g.topics);
  if (!all.some(t => t.id === state.selected)) state.selected = all[0]?.id || '';
  for (const g of gs) {
    toc.append(el('p', 'hp-gl', g.label));
    for (const t of g.topics) {
      const b = el('button', 'hp-toc-btn', t.label); b.type = 'button'; b.dataset.hpPick = t.id;
      if (t.id === state.selected) b.setAttribute('aria-current', 'true');
      toc.append(b);
    }
  }
  const art = el('article', 'hp-detail'); art.dataset.hpDetail = '';
  const t = helpTopic(state.selected);
  if (t) { const h = el('h3', 'hp-dt', t.label); art.append(h, ...bodyNodes(t)); }
  wrap.append(toc, art);
  box.append(wrap);
}
function draw() {
  const box = root(); if (!box) return;
  const gs = groups();
  box.replaceChildren();
  if (!gs.length) box.append(emptyEl('찾는 글이 없어요'));
  else if (WIDE.matches) drawWide(box, gs); else drawNarrow(box, gs);
  state.painted = true;
}
function select(id, {scroll = false} = {}) {
  state.selected = helpTopic(id) ? id : '';
  window.KPTURouter?.setPlace?.('help', {topic: state.selected || null});
  draw();
  if (scroll && state.selected && !WIDE.matches) root()?.querySelector(`[data-hp-topic="${CSS.escape(state.selected)}"]`)?.scrollIntoView?.({block: 'start'});
}

async function enter() {
  state.query = ''; refreshScreenFind();
  try { const {myFeaturesOrNull} = await import('./my-features.js'); state.features = await myFeaturesOrNull(); } catch { state.features = null; }
  // 기능 목록을 읽은 뒤에 펼칠 줄을 정한다(들어오기 신호가 두 번 와도 둘째는 첫째가 주소에 적은 줄을 그대로 읽는다).
  const asked = takeHelpTopic() || window.KPTURouter?.place?.('help')?.topic || '';
  select(asked, {scroll: true});
}

function bind() {
  const v = document.getElementById('helpView'); if (!v || v.dataset.hpBound) return; v.dataset.hpBound = '1';
  v.addEventListener('click', e => {
    const pick = e.target.closest?.('[data-hp-pick]'); if (pick) { select(pick.dataset.hpPick); root()?.querySelector('[data-hp-detail]')?.scrollIntoView?.({block: 'nearest'}); return; }
    const go = e.target.closest?.('[data-hp-go]');
    if (go) { const view = go.dataset.hpGo; if (view === 'note') window.KPTURouter?.go?.('basket', {source: 'delegated', sub: 'note'}); else window.KPTURouter?.go?.(view, {source: 'delegated'}); }
  });
  // 폰: 펼칠 때 내용을 그 자리에서 그린다(한 번에 하나만 펼쳐 둠 — 펼친 줄이 주소에 남는다).
  v.addEventListener('toggle', e => {
    const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.dataset.hpTopic || state.query) return;
    if (d.open) {
      const t = helpTopic(d.dataset.hpTopic); const body = d.querySelector('.hp-body');
      if (t && body && !body.childElementCount) body.append(...bodyNodes(t));
      v.querySelectorAll('details.hp-item[open]').forEach(o => { if (o !== d) o.open = false; });
      state.selected = d.dataset.hpTopic; window.KPTURouter?.setPlace?.('help', {topic: state.selected});
    } else if (state.selected === d.dataset.hpTopic) { state.selected = ''; window.KPTURouter?.setPlace?.('help', {topic: null}); }
  }, true);
  WIDE.addEventListener?.('change', () => { if (state.painted) draw(); });
}

install(); bind();
// 찾기 = 맨 위 칸 하나(용어 기준표 '<메뉴>에서 찾기'). 치는 대로 이 화면 목록만 거른다(서버 호출 없음, 예전 화면 안 칸과 같은 matchTopic).
const helpShown = () => window.KPTURouter?.current === 'help' && !document.getElementById('helpView')?.classList.contains('hidden');
registerScreenFind('help', {
  label: '쓰는 법에서 찾기',
  meaning: false,
  active: helpShown,
  value: () => state.query,
  apply: q => { const next = String(q ?? ''); if (next === state.query) return; state.query = next; draw(); },
});
window.KPTURouter?.on?.('help', () => { void enter(); });
void enter();
