// 준비 '한 장' 공용 그리기(같은 부품 한 벌): 다음 주 준비 한 장(journal-weekly.js [다음 주] 칸)과 교섭·회의 전 한 장(pre-meeting-sheet.js)이 같이 쓴다.
// 모양: 머리(제목 · 만든 시각 · [지금 만들기]/[다시 만들기]) → 보조 줄 → '핵심 세 가지'(줄마다 근거) → 묶음(<details>, 접혀 있어도 한 줄 요약).
// 그리는 곳은 부르는 쪽이 가진 상자 하나(host)이고, 이 함수는 그 상자만 다시 그린다. 누르기 처리는 부르는 쪽이 data 속성으로 받는다.
// skin: {cls:상자 클래스 앞머리, data:data 속성 앞머리(camelCase), heading, sub, open, list, day, muted, button} — 화면마다 기존 클래스·시험 이름을 그대로 둔다.
// ui: {state:'loading'|'missing'|'failed'|'ok', title, sub, view, canMake, busy, message, error, open:Set(묶음 key), notes:{missing,failed,none,empty}}
// 기다림(state 'loading')은 공용 wait-state.js 부품(글자 없는 회색 줄).
// view(모델이 만든 모양): {made, top:[{text, refs}], aiNote, empty, changed, groups:[{key,label,summary,items:[{index,day,title,org,ai,refs}]}]}
// 기기 저장 없음.
import {waitEl, emptyEl} from './wait-state.js';

const ds = (prefix, name) => prefix + name.charAt(0).toUpperCase() + name.slice(1);

export function renderPrepSheet(host, ui, skin) {
  const doc = host.ownerDocument, S = skin;
  const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const button = (cls, text, data) => {
    const b = el('button', cls, text); b.type = 'button';
    for (const [k, v] of Object.entries(data)) b.dataset[ds(S.data, k)] = v;
    b.disabled = !!ui.busy; return b;
  };
  host.replaceChildren();
  host.dataset[S.stateKey || ds(S.data, 'state')] = ui.state;
  const v = ui.view, notes = ui.notes || {}, head = el('div', `${S.cls}-head`);
  head.append(el(S.heading.tag, S.heading.cls, ui.title));
  const meta = el('span', `${S.cls}-meta`);
  if (v?.made) meta.append(el('span', S.muted, v.made));
  if (ui.state === 'ok' && ui.canMake) meta.append(button(S.button, v ? '다시 만들기' : '지금 만들기', {make:'user'}));
  head.append(meta);
  host.append(head);
  if (ui.sub) host.append(el('p', `${S.muted} ${S.cls}-subline`, ui.sub));
  const note = text => { const p = el('p', `${S.muted} ${S.cls}-note`, text); host.append(p); return p; };
  if (ui.message || ui.busy) { const p = note(ui.busy ? '만드는 중…' : ui.message); p.setAttribute('role', 'status'); if (ui.error) p.classList.add('is-error'); }
  if (ui.state === 'loading') { host.append(waitEl({rows:3})); return; }
  if (ui.state === 'missing') { note(notes.missing); return; }
  if (ui.state === 'failed') { note(notes.failed); return; }
  if (!v) { note(notes.none); return; }
  if (v.changed) note(v.changed);
  if (v.top.length) {
    host.append(el('p', `${S.cls}-sub`, '핵심 세 가지'));
    const ol = el('ol', `${S.cls}-top`);
    for (const t of v.top) {
      const li = el('li');
      if (t.refs.length) li.append(button(S.open, t.text, {ref:String(t.refs[0])})); else li.append(el('span', null, t.text));
      ol.append(li);
    }
    host.append(ol);
  }
  if (v.aiNote) note(v.aiNote);
  if (v.empty) { host.append(emptyEl(notes.empty)); return; }
  for (const g of v.groups) {
    const box = el('details', `${S.cls}-group`); box.dataset[ds(S.data, 'group')] = g.key;
    if (ui.open?.has(g.key)) box.open = true;
    const sum = el('summary'); sum.append(el('span', `${S.cls}-label`, g.label), ' ', el('span', S.muted, g.summary));
    box.append(sum);
    const list = el('ul', S.list);
    for (const it of g.items) {
      const li = el('li'); li.dataset[ds(S.data, 'item')] = String(it.index);
      if (it.day) li.append(el('span', S.day, it.day));
      if (it.ai) {
        // AI가 정리한 줄: 누르면 근거 줄로(근거 꼬리표).
        li.append(el('span', `${S.cls}-ai`, it.title));
        if (it.refs?.length) { const tag = button(`${S.cls}-tag`, '근거', {ref:String(it.refs[0])}); tag.setAttribute('aria-label', `${it.title} (근거 줄로)`); li.append(' ', tag); }
      } else if (it.open === false) {
        li.append(el('span', null, it.title));
      } else {
        const open = button(S.open, it.title, {open:String(it.index)});
        open.setAttribute('aria-label', `${it.title} (원래 기록 열기)`);
        li.append(open);
      }
      if (it.org) li.append(' ', el('span', S.muted, it.org));
      list.append(li);
    }
    box.append(list);
    host.append(box);
  }
  if (S.footer) host.append(el('p', `${S.muted} ${S.cls}-foot`, S.footer));
}
