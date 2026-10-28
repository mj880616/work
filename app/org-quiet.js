// FEAT-1029묶음 ③ 오래 연락 안 한 담당조직: 홈 '연락 없는 조직' 줄의 유일한 renderer(설계 docs/design/feature-bundle-1029.md 3절, 시안 mockups/org-quiet-line.html).
// 줄: '3주째 연락 없음: 가지부 25일 · 나지부 40일 · 다분회 62일 외 2곳 ›'. 이름을 누르면 그 담당조직 상세, ›를 누르면 조직마다 '마지막 · 통화 10.3'.
// - 무엇을 '연락'으로 세는지는 org-quiet-model.mjs(명진 결정 10/29): 주요 인물과의 통화, 텔레그램에서 내가 묻고 그쪽이 답한 것만.
// - 내 담당조직만(my-organizations.js selectMyOrganizations). 담당 지정이 없어 전체로 물러난 경우(fallback)에는 줄을 그리지 않는다.
// - 읽기는 모두 로그인 토큰 REST(소유자 RLS 그대로): 담당조직·담당 행, 주요 인물(app_org_key_people), 업무 통화(손 고침 반영. 개인 통화함은 설계 3.2대로 읽지 않음),
//   텔레그램 보낸 사람 이름표(tg-sender-data.js), 그리고 '나'와 주요 인물이 함께 있는 방·날의 원문만. 새 표·새 함수·AI 없음(비용 0원).
// - 한 곳이라도 읽지 못하면 줄을 숨긴다(틀린 '연락 없음'을 보이지 않기 위해). 조용한 조직이 없거나 기준이 '끄기'면 줄을 그리지 않는다.
// - 기준 주 수는 서버 화면 기억(view_prefs.quiet_weeks, 홈 편집에서 고름). 화면 사본은 두지 않는다(기기 저장 없음).
import {viewPrefs} from './view-prefs.js';
import {selectMyOrganizations} from './my-organizations.js';
import {readRecordPages} from './basket-link-records.js';
import {readCallEdits} from './feed-data.js';
import {readSenders} from './tg-sender-data.js';
import {applyCallEdit, missingTable, kstDay, telegramLines} from './feed-model.mjs';
import {weeksOf, addDays, LOOKBACK_DAYS, talkDays, splitKey, orgsOfPeople, lastCallDays, answeredBy, mergeLast, quietList, daysText, lastText, headParts} from './org-quiet-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const enc = encodeURIComponent;
const RAW_BATCH = 12, RAW_CAP = 80; // 원문은 한 번에 12개 방·날씩, 모두 80개까지

class Hide extends Error {}
const ctxOf = rt => rt?.context?.read?.() || {};

async function readMine(rt, ws) {
  const userId = ctxOf(rt).user?.id || '';
  if (!userId) throw new Hide();
  const [orgs, assignees] = await Promise.all([
    readRecordPages(`/rest/v1/app_suborganizations?workspace_id=eq.${enc(ws)}&select=id,name,active&order=id.asc`, rt),
    readRecordPages(`/rest/v1/app_suborganization_assignees?user_id=eq.${enc(userId)}&select=organization_id&order=organization_id.asc`, rt)]);
  const mine = selectMyOrganizations(orgs.filter(o => o?.id), assignees.filter(a => a?.organization_id));
  if (mine.fallback) throw new Hide();
  return mine.organizations;
}
async function readPeople(rt, ws, orgIds) {
  try {
    const rows = await readRecordPages(`/rest/v1/app_org_key_people?workspace_id=eq.${enc(ws)}&select=id,organization_id,name,match_names&order=organization_id.asc,sort_order.asc,id.asc`, rt);
    return rows.filter(p => p?.id && orgIds.has(p.organization_id));
  } catch (error) { if (missingTable(error)) throw new Hide(); throw error; }
}
async function readCalls(rt, ws, from) {
  const [work, edits] = await Promise.all([
    readRecordPages(`/rest/v1/app_feed_items?workspace_id=eq.${enc(ws)}&source=eq.call&hidden_at=is.null&day=gte.${from}&select=id,day,occurred_at,title,counterpart,organization_id,points&order=day.desc,id.asc`, rt),
    readCallEdits(rt).catch(error => { if (missingTable(error)) return null; throw error; })]);
  return (work || []).map(r => edits?.get?.(r.id) ? applyCallEdit(r, edits.get(r.id)) : r);
}
// 그 방의 그 날들 원문(지운 소식 제외). Map('방\0날' → 줄 목록).
async function readRaw(rt, ws, list) {
  const byRoom = new Map();
  for (const c of list) byRoom.set(c.room_key, [...(byRoom.get(c.room_key) || []), c.day]);
  const out = new Map();
  await Promise.all([...byRoom].map(async ([room, days]) => {
    const rows = await readRecordPages(`/rest/v1/app_feed_items?workspace_id=eq.${enc(ws)}&source=eq.telegram&hidden_at=is.null&room_key=eq.${enc(room)}&day=in.(${days.map(enc).join(',')})&select=id,room_key,day,occurred_at,raw_text&order=day.asc,occurred_at.asc,id.asc`, rt);
    for (const r of rows) {
      if (!r?.raw_text || r.room_key !== room) continue;
      const k = `${room}\u0000${String(r.day).slice(0, 10)}`;
      out.set(k, [...(out.get(k) || []), ...telegramLines(r.raw_text)]);
    }
  }));
  return out;
}

// 조용한 조직 목록. null = 줄을 그리지 않음(끔·담당 없음·주요 인물 없음).
export async function computeQuiet(rt = window.KPTURuntime, weeks = weeksOf(viewPrefs.get('quiet_weeks'))) {
  if (!weeks) return null;
  const ws = ctxOf(rt).workspace?.id;
  if (!ws || !rt?.api) return null;
  const today = kstDay(), from = addDays(today, -LOOKBACK_DAYS), cutoff = addDays(today, -(weeks * 7 - 1));
  try {
    const orgs = await readMine(rt, ws);
    const people = await readPeople(rt, ws, new Set(orgs.map(o => o.id)));
    if (!people.length) return null;
    const [calls, senders] = await Promise.all([readCalls(rt, ws, from), readSenders(rt)]);
    const callDays = lastCallDays(calls, people), talks = talkDays(senders, people, from), orgsOf = orgsOfPeople(people);
    const best = new Map(callDays), tgDays = new Map(), unsure = new Set();
    const bump = (org, day) => { if (!best.has(org) || best.get(org) < day) best.set(org, day); if (!tgDays.has(org) || tgDays.get(org) < day) tgDays.set(org, day); };
    // 방·날마다 그 날 이름표에 있는 주요 인물의 조직. 최신 날부터 본다(기준 안부터 확인됨).
    const queue = [...talks.entries()].map(([key, labels]) => {
      const o = new Set();
      for (const w of labels.values()) for (const pid of w.people) for (const org of orgsOf.get(pid) || []) o.add(org);
      return {key, ...splitKey(key), orgs:o};
    }).sort((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key));
    const needed = c => [...c.orgs].some(org => !best.has(org) || best.get(org) < c.day);
    let checked = 0;
    for (let i = 0; i < queue.length;) {
      const batch = [];
      while (i < queue.length && batch.length < RAW_BATCH) { const c = queue[i++]; if (needed(c)) batch.push(c); }
      if (!batch.length) break;
      if (checked + batch.length > RAW_CAP) {
        // 다 보지 못한 방·날: 기준 안이면 판단할 수 없어 줄을 숨기고, 기준보다 오래된 것이면 그 조직의 마지막 날만 '확인 못함'으로 둔다.
        for (const c of [...batch, ...queue.slice(i)].filter(needed)) {
          if (c.day >= cutoff) return null;
          for (const org of c.orgs) if (!best.has(org) || best.get(org) < c.day) unsure.add(org);
        }
        break;
      }
      checked += batch.length;
      const raw = await readRaw(rt, ws, batch);
      for (const c of batch) {
        const labels = talks.get(c.key);
        for (const pid of answeredBy(raw.get(c.key) || [], label => labels.get(label) || null)) for (const org of orgsOf.get(pid) || []) bump(org, c.day);
      }
    }
    return quietList({orgs, people, last:mergeLast(callDays, tgDays), unsure, today, weeks});
  } catch (error) {
    if (!(error instanceof Hide)) console.warn('org quiet', error?.message || error);
    return null;
  }
}

export function mountOrgQuiet(el, {rt = window.KPTURuntime} = {}) {
  if (!el) return null;
  let run = 0, open = false, data = null, alive = true;
  const today = () => kstDay();
  function paint() {
    const rows = data?.rows || [];
    if (!rows.length) { el.hidden = true; el.innerHTML = ''; return; }
    const weeks = weeksOf(viewPrefs.get('quiet_weeks')), {shown, more} = headParts(rows), d = today();
    const name = r => `<button type="button" class="oq-org" data-oq-org="${esc(r.id)}">${esc(r.name)}</button>`;
    const head = open
      ? `<span class="oq-text">${weeks}주째 연락 없음 ${rows.length}곳</span>`
      : `<span class="oq-text">${weeks}주째 연락 없음: ${shown.map(r => `${name(r)} <span class="oq-d">${esc(daysText(r))}</span>`).join(' · ')}${more ? ` 외 ${more}곳` : ''}</span>`;
    el.hidden = false;
    el.classList.toggle('is-open', open);
    el.innerHTML = `<h3 id="home-quiet-title" class="a11y-only">연락 없는 조직</h3><div class="oq-line">${head}<button type="button" class="oq-toggle" data-oq-toggle aria-expanded="${open}" aria-controls="homeQuietList" aria-label="${open ? '연락 없는 조직 접기' : '연락 없는 조직 펼치기'}">${open ? '⌄' : '›'}</button></div>`
      + `<ul class="oq-list" id="homeQuietList"${open ? '' : ' hidden'}>${rows.map(r => `<li class="oq-row">${name(r)}<span class="oq-last">${esc(lastText(r, d))}</span><span class="oq-days">${esc(daysText(r))}</span></li>`).join('')}`
      + `${data.skipped ? `<li class="oq-note">주요 인물이 없는 담당조직 ${data.skipped}곳은 세지 않음</li>` : ''}</ul>`;
  }
  async function refresh() {
    const mine = ++run;
    const out = await computeQuiet(rt);
    if (!alive || mine !== run) return;
    data = out; paint();
  }
  el.addEventListener('click', async event => {
    const toggle = event.target.closest('[data-oq-toggle]'), org = event.target.closest('[data-oq-org]');
    if (toggle) { open = !open; paint(); el.querySelector('[data-oq-toggle]')?.focus({preventScroll: true}); return; }
    if (org) {
      window.KPTURouter?.go('team', {source: 'delegated'});
      try { await window.KPTUViewLoader?.load?.('team'); await window.KPTUWorkplace?.open?.(org.dataset.oqOrg); } catch (error) { console.error('org quiet open', error); }
    }
  });
  const onPrefs = () => void refresh();
  const EVENTS = ['kptu:view-prefs-ready', 'kptu:quiet-weeks-changed'];
  EVENTS.forEach(name => window.addEventListener(name, onPrefs));
  return {refresh, destroy() { alive = false; run++; EVENTS.forEach(name => window.removeEventListener(name, onPrefs)); }};
}
