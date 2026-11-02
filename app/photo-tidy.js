// S46-20 사진 정리 제안 ①(요청함 10/31 11:04, 시안 확정 10/31 13:2x): 사진 메뉴 위 [정리 n] 칩 → 접힌 칸.
// ① 거르기 줄 [전체|폰에만|원드라이브에만|둘 다] ② 백업 안 됨 n개 폴더 ⑤ 잡동사니(1년 지난 스크린샷·카톡·텔레그램 받은 사진) n장.
// 줄마다 한 줄 요약 + [보기](<details>). S47-19(요청함 11/01 12:55·12:56): 모든 [보기]는 그 줄 아래에서 사진 칸으로 펼친다(합계 용량·정렬 칩). 지우기·숨기기는 명진이 눌러야만(폰 휴지통은 시스템 확인 창도). 자동 삭제 없음.
// - 재료: 폰 사진 전부(앱 다리, 끈 폴더 포함)와 원드라이브 사진 전부(서버 library, 고른 폴더 색인). [정리]를 처음 누를 때 읽는다.
//   사진·목록은 이 화면 메모리에만 있고 기기·서버에 저장하지 않는다(폰 사진은 서버로 올라가지 않는다).
// - 규칙은 photo-tidy-model.mjs(같은 사진 판정은 섞어 보기 규칙 그대로).
// - S47-20(요청함 11/01 12:57): 줄마다 쉬운 설명 한 줄(늘 보임) + 할 일 한 줄(펼치면). 찾은 결과는 앱(웹 화면)을 끄기 전까지 이 메모리에 그대로 두고,
//   [정리]를 다시 열면 지난 결과를 바로 보인다. 새로 찾기는 맨 위 [다시 찾기](또는 지우기 직전 10분 확인)만. 계정이 바뀌면 지운다(reset).
import {matchIndex, placeItems, placeCounts, unbackedFolders, junkGroups, groupHidden, tidyCount, forgetIds, sizeText, PLACES, PLACE_TEXT, SCAN_MAX,
  spacePlan, dupGroups, dupTrashList, scanFresh, DUP_TEXT, copyPairs, goneText,
  TIDY_SORTS, DUP_SORTS, paneSortDefault, sortTidy, sortDupGroups, totalBytes, dupStats, dupStatText, whereLines, copiesFinder, DUP_HOW,
  partlyBackedFolders, TIDY_HELP, JUNK_HELP, partlyText, foundText, similarCandidates, similarGroups, SIMILAR_BATCH} from './photo-tidy-model.mjs';
import {waitInlineHtml} from './wait-state.js';

const PAGE = 200;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// S47-32 PHOTO-비슷한사진: hashThumb(폰 칸) = 화면이 받는 작은 미리보기로 만든 64비트 해시(16진수, 못 만들면 ''). 없으면 비슷한 사진 칩이 없다.
//   [비슷한 사진] 칩을 처음 누를 때 SIMILAR_BATCH장씩 나눠 계산한다(묶음마다 다시 그림). 해시는 이 메모리에만, [다시 찾기]·계정 바뀜에 지운다.
// S47-16 PHOTO-폰지우기안전장치: watchTrash() = 다음 사진 확인 때 서버가 폰에서 지운 사진의 원드라이브 사본이 사라졌는지 본 수(경고 한 줄), seenTrash() = [알았어요].
export function createPhotoTidy({phone, readOd, odReady, odError, phoneError, phoneOff, onChange, isStarred = () => false, now = () => Date.now(),
  watchTrash = async () => 0, seenTrash = async () => {}, hashThumb = null, pause = () => new Promise(ok => setTimeout(ok, 0))}) {
  let st = null, token = 0;
  const keeps = new Map(); // ④ 명진이 고른 남길 것(묶음 id → 칸 id), 이 화면 메모리만
  // S47-19: 펼친 [보기](key → 정렬). 'place:phone'·'space'·'junk:kakao'·'unbacked:<폰 폴더>'·'dups'(묶음 정렬만).
  // 고른 정렬은 이 화면 메모리만(서버 view_prefs.photo_view에 칸이 없어 DB 변경이 있어야 저장할 수 있다).
  const panes = new Map(), sorts = new Map();
  const sortOf = key => sorts.get(key) || (key === 'dups' ? 'save' : paneSortDefault(key));
  // S47-19B: 묶음 종류 칩('copy'·'burst', 있는 종류 먼저), 비교 칸의 오른쪽 사진 번호(묶음 id → 남길 것 말고 몇 번째). 이 화면 메모리만.
  let dupKind = '';
  const cmpAt = new Map();
  const hashes = new Map(); // S47-32 칸 id → 해시(이 화면 메모리만)
  const simOn = () => !!hashThumb && !!st?.simCand.length;
  const dupKindOf = () => (dupKind === 'similar' && simOn() ? 'similar' : st?.dups.some(g => g.kind === dupKind) ? dupKind
    : st?.dups.some(g => g.kind === 'copy') ? 'copy' : st?.dups.some(g => g.kind === 'burst') ? 'burst' : 'similar');
  const SHOWN_DUPS = 40;
  const shownDups = () => sortDupGroups(st.dups.filter(g => g.kind === dupKindOf()), sortOf('dups')).slice(0, SHOWN_DUPS);
  const keepOf = g => (g.items.some(p => p.id === keeps.get(g.id)) ? keeps.get(g.id) : g.keep);
  let copies = null; // 원드라이브 같은 사진 찾기(읽은 뒤 한 번 만든다)
  const where = p => whereLines(p, st.odOn ? (copies ||= copiesFinder(st.od))(p) : []);
  const when = p => { const t = Date.parse(p.taken_at); if (!Number.isFinite(t)) return ''; const d = new Date(t + 9 * 3600e3).toISOString(); return `${d.slice(0, 10).replace(/-/g, '.')} ${d.slice(11, 19)}`; };
  // 비교 칸: 왼쪽 = 남길 사진, 오른쪽 = 나머지 중 하나(‹ ›로 넘김). 사진마다 있는 곳·용량·찍은 시각, [이것 남기기].
  function cmpHtml(g, keep) {
    const left = g.items.find(p => p.id === keep), others = g.items.filter(p => p.id !== keep);
    const i = Math.min(cmpAt.get(g.id) || 0, others.length - 1), right = others[i];
    const slot = p => `<div class="photos-tidy-cmp-slot"><button type="button" class="photos-tidy-cmp-ph" data-photos-tidy-cmp-open="${esc(g.id)}|${esc(p.id)}" aria-label="크게 보기"><span class="photos-tidy-th" data-photos-tidy-th="${esc(p.id)}" data-size="large"></span></button>`
      + where(p).map(w => `<span class="photos-tidy-where">${esc(w)}</span>`).join('')
      + `<span class="photos-tidy-num">${[sizeText(p.size_bytes), when(p), p.width && p.height ? `${p.width}×${p.height}` : ''].filter(Boolean).join(' · ')}</span>`
      + `<button type="button" class="mini" data-photos-tidy-keep="${esc(g.id)}|${esc(p.id)}" aria-pressed="${p.id === keep}">${p.id === keep ? '남길 사진' : '이것 남기기'}</button></div>`;
    return `<div class="photos-tidy-cmp" data-photos-tidy-cmp="${esc(g.id)}"><div class="photos-tidy-cmp-pair">${slot(left)}${slot(right)}</div>`
      + (others.length > 1 ? `<div class="photos-tidy-cmp-nav"><button type="button" class="mini" data-photos-tidy-cmp-step="${esc(g.id)}|-1" aria-label="앞 사진">‹</button><span class="photos-tidy-num">${i + 1} / ${others.length}</span><button type="button" class="mini" data-photos-tidy-cmp-step="${esc(g.id)}|1" aria-label="다음 사진">›</button></div>` : '')
      + '</div>';
  }
  const empty = () => ({running:false, done:false, partial:false, failed:'', odFailed:'', od:[], ph:[], odOn:false, index:null, unbacked:[], partly:[], junk:[], counts:null, space:null, dups:[], simCand:[], sim:{running:false, done:false, count:0}, at:0, gone:0, stale:false});
  const changed = () => { try { onChange?.(); } catch { /* 화면 다시 그리기 실패가 읽기를 막지 않게 */ } };
  function derive() {
    if (!st) return;
    st.index = matchIndex(st.od, st.ph);
    st.unbacked = st.odOn ? unbackedFolders(st.ph, st.index) : [];
    st.partly = st.odOn ? partlyBackedFolders(st.ph, st.index) : [];
    st.junk = junkGroups(st.ph);
    st.counts = st.odOn ? placeCounts({odItems:st.od, phItems:st.ph, index:st.index, off:phoneOff()}) : null;
    st.space = st.odOn ? spacePlan(st.ph, st.index, {now:now(), isStarred}) : null;
    const base = dupGroups(st.ph), skip = new Set(base.flatMap(g => g.items.map(p => p.id)));
    st.simCand = hashThumb ? similarCandidates(st.ph, skip) : [];
    st.dups = [...base, ...similarGroups(st.simCand, hashes)];
    copies = null;
  }
  // S47-32 비슷한 사진: 아직 해시 없는 후보를 SIMILAR_BATCH장씩(동시 6장) 만들고, 한 묶음마다 다시 묶어 그린다. 못 만든 칸은 ''(묶지 않음).
  async function hashSimilar(t) {
    if (!st || st.sim.running || st.sim.done || !simOn()) return;
    st.sim.running = true; st.sim.count = st.simCand.filter(p => hashes.has(p.id)).length; changed();
    const todo = st.simCand.filter(p => !hashes.has(p.id));
    for (let i = 0; i < todo.length; i += SIMILAR_BATCH) {
      const batch = todo.slice(i, i + SIMILAR_BATCH);
      let next = 0;
      const one = async () => {
        while (next < batch.length) {
          const p = batch[next++];
          let h = '';
          try { h = String(await hashThumb(p) || ''); } catch { h = ''; }
          if (t !== token) return;
          hashes.set(p.id, h);
        }
      };
      await Promise.all(Array.from({length:Math.min(6, batch.length)}, one));
      if (t !== token || !st) return;
      st.sim.count = st.simCand.filter(p => hashes.has(p.id)).length;
      derive(); changed();
      await pause();
      if (t !== token || !st) return;
    }
    st.sim.running = false; st.sim.done = true;
    derive(); changed();
  }
  async function scanPhone(t) {
    for (let offset = 0; st.ph.length < SCAN_MAX;) {
      const page = await phone.page({sort:'taken_desc', filter:'all', offset, limit:PAGE});
      if (t !== token) return;
      st.ph.push(...page.items);
      changed();
      if (page.next === null || page.next <= offset) return;
      offset = page.next;
    }
    st.partial = true;
  }
  async function scanOd(t) {
    let cursor = null;
    while (st.od.length < SCAN_MAX) {
      const page = await readOd(cursor, PAGE);
      if (t !== token) return;
      st.od.push(...page.items);
      changed();
      if (!page.next) return;
      cursor = page.next;
    }
    st.partial = true;
  }
  async function scan() {
    const t = ++token;
    hashes.clear();
    st = {...empty(), running:true, odOn:odReady()};
    changed();
    const jobs = [scanPhone(t).catch(e => { if (t === token) st.failed = phoneError(e); })];
    if (st.odOn) jobs.push(scanOd(t).catch(e => { if (t === token) { st.odFailed = odError(e); st.odOn = false; } }));
    await Promise.all(jobs);
    if (t !== token) return;
    st.running = false; st.done = !st.failed; st.at = now();
    derive(); changed();
    // 지운 사진 사본 검사(원드라이브를 다시 읽은 뒤). 실패하면 경고 없이 넘어간다(다음 확인 때 다시).
    if (st.odOn) watchTrash().then(n => { if (t === token && Number.isInteger(n) && n > 0) { st.gone = n; changed(); } }).catch(() => {});
  }
  const ready = () => !!st?.done;
  const api = {
    get state() { return st; },
    ready,
    // 처음 열 때만 읽는다(새로 찾기는 [다시 찾기]만). 지난 결과가 있으면 그대로 보인다.
    open() { if (!st) scan(); },
    rescan: () => scan(),
    reset() { token++; st = null; keeps.clear(); panes.clear(); cmpAt.clear(); hashes.clear(); },
    // 찾은 뒤 폰 쪽이 바뀌었다(폰 폴더 옮기기·사진 접근 바꿈): 결과는 두고 맨 위 한 줄에만 알린다.
    stale() { if (st?.done && !st.stale) { st.stale = true; changed(); } },
    // 끈 폴더가 바뀌면 장수만 다시.
    offChanged() { if (ready()) { derive(); } },
    count: () => (ready() ? tidyCount(st, phoneOff()) + (st.space?.items.length ? 1 : 0) + (st.dups.length ? 1 : 0) : 0),
    // ③ 지우기 전: 읽은 지 10분 안이어야 한다(아니면 다시 확인).
    fresh: () => ready() && scanFresh(st.at, now()),
    item: id => (st ? st.ph.find(p => p.id === id) || null : null),
    unbackedIds: () => new Set(ready() ? st.unbacked.map(f => f.id) : []),
    // 보기 목록(정렬 전): 'place:phone' · 'space' · 'junk:kakao' · 'unbacked:<폰 폴더>' · 'partly:<폰 폴더>'(못 찾은 사진만). 없으면 null.
    list(key) {
      if (!ready()) return null;
      const k = String(key || ''), at = k.indexOf(':'), kind = at < 0 ? k : k.slice(0, at), name = at < 0 ? '' : k.slice(at + 1);
      if (kind === 'place' && st.odOn && PLACES.includes(name) && name !== 'all') return placeItems(name, {odItems:st.od, phItems:st.ph, index:st.index, off:phoneOff()});
      if (kind === 'junk') return st.junk.find(g => g.kind === name)?.items.slice() || null;
      if (kind === 'space') return st.space?.items.length ? st.space.items.slice() : null;
      if (kind === 'unbacked') return st.unbacked.some(f => f.id === name) ? st.ph.filter(p => p.folder === name) : null;
      if (kind === 'partly') return st.partly.some(f => f.id === name) ? st.ph.filter(p => p.folder === name && !st.index.phoneHas.has(p.id)) : null;
      return null;
    },
    // 펼친 칸에 보일 목록(고른 정렬). 없으면 null.
    paneList: key => { const list = api.list(key); return list ? sortTidy(list, sortOf(key)) : null; },
    // [보기] 펼치기/접기. 어디에 있나 칩은 하나만 펼친다('place:all' = 접기).
    toggle(key) {
      const k = String(key || '');
      if (k.startsWith('place:')) { const was = panes.has(k); for (const x of [...panes.keys()]) if (x.startsWith('place:')) panes.delete(x); if (!was && api.list(k)) panes.set(k, true); return; }
      if (panes.has(k)) panes.delete(k); else if (api.list(k) || (k.startsWith('dup:') && st?.dups.some(g => g.id === k.slice(4)))) panes.set(k, true);
    },
    opened: key => panes.has(key),
    sortSet(key, s) { if ((key === 'dups' ? DUP_SORTS : TIDY_SORTS)[s]) sorts.set(key, s); },
    group(kind) {
      if (!ready()) return null;
      if (kind === 'space') return st.space?.items.length ? {kind, label:'원드라이브에 있는 폰 사진', items:st.space.items.slice(), folders:[]} : null;
      if (kind === 'dups') { const items = dupTrashList(shownDups(), keeps); /* 화면에 보인 그 종류 묶음만 */ return items.length ? {kind, label:`${DUP_TEXT[dupKindOf()]} 묶음의 남기지 않을 사진`, items, folders:[]} : null; }
      if (kind.startsWith('dup|')) { const g = st.dups.find(x => x.id === kind.slice(4)); const items = g ? dupTrashList([g], keeps) : []; return items.length ? {kind, label:`${DUP_TEXT[g.kind]} 묶음의 남기지 않을 사진`, items, folders:[]} : null; }
      return st.junk.find(g => g.kind === kind) || null;
    },
    // S47-16: 지울 폰 사진의 원드라이브 사본 짝({pairs, noCopy}). 원드라이브를 읽지 못했으면 null(지우지 않음).
    copyPairs: items => (ready() && st.odOn ? copyPairs(items, st.od) : null),
    // S48-32: 사진 정리가 읽은 폰 사진 전부(고른 원드라이브 칸의 폰 원본 짝 찾기). 읽지 못했으면 null.
    phoneItems: () => (ready() ? st.ph : null),
    goneSeen() { if (!st?.gone) return; st.gone = 0; changed(); seenTrash().catch(() => {}); },
    // ④ 남길 것 고르기.
    keep(groupId, itemId) { const g = st?.dups.find(x => x.id === groupId); if (g && g.items.some(p => p.id === itemId)) { keeps.set(groupId, itemId); cmpAt.delete(groupId); } },
    // S47-19B: 묶음 종류 칩·비교 칸 넘기기·묶음 사진(크게 보기 목록).
    dupKind(k) { if (!DUP_TEXT[k] || (k === 'similar' && !simOn())) return; dupKind = k; if (k === 'similar' && ready()) hashSimilar(token); },
    cmpStep(groupId, d) { const g = st?.dups.find(x => x.id === groupId); if (!g) return; const n = g.items.length - 1; if (n > 0) cmpAt.set(groupId, (((cmpAt.get(groupId) || 0) + d) % n + n) % n); },
    groupItems: groupId => st?.dups.find(x => x.id === groupId)?.items.slice() || null,
    // 지운 칸(폰 휴지통·원드라이브 휴지통 뒤)을 재료에서 뺀다.
    forget(ids) {
      if (!st || !ids?.length) return;
      st.od = forgetIds(st.od, ids); st.ph = forgetIds(st.ph, ids);
      if (ready()) derive();
    },
    // 접힌 칸 HTML. canHide = 폰 폴더 스위치를 쓸 수 있음(앱 0.4.1+), canTrash = 폰 휴지통.
    html({canHide = false, canTrash = false} = {}) {
      if (!st) return '';
      if (st.running) return `<p class="photos-tidy-line" role="status">사진 확인 중 · 폰 ${st.ph.length}장${st.odOn ? ` · 원드라이브 ${st.od.length}장` : ''}</p>`;
      if (st.failed) return `<p class="photos-tidy-line">${esc(st.failed)} <button type="button" class="mini" data-photos-tidy-rescan>다시 찾기</button></p>`;
      const off = phoneOff(), rows = [];
      // 펼친 칸: 합계 용량 + 정렬 칩 + 사진 칸 자리(사진은 photos.js가 처음 일정 장수만 그리고 스크롤로 이어 그린다).
      const chips = (key, names) => `<span class="photos-tidy-sorts" role="group" aria-label="정렬">${Object.entries(names).map(([s, t]) =>
        `<button type="button" class="photos-tidy-place" data-photos-tidy-sort="${esc(key)}|${s}" aria-pressed="${s === sortOf(key)}">${t}</button>`).join('')}</span>`;
      const pane = key => {
        const list = api.list(key); if (!list) return '';
        const b = totalBytes(list);
        return `<div class="photos-tidy-pane" data-photos-tidy-pane="${esc(key)}"><div class="photos-tidy-pane-head"><span class="photos-tidy-num">${list.length}장${b ? ' · 합계 ' + sizeText(b) : ''}</span>${chips(key, TIDY_SORTS)}</div>`
          + '<div class="photos-tidy-grid" data-photos-tidy-grid></div><p class="photos-tidy-line" data-photos-tidy-more hidden></p></div>';
      };
      const placeOpen = PLACES.find(p => panes.has('place:' + p)) || 'all';
      // 펼치지 않아도 보이는 설명 한 줄(summary 안).
      const help = t => `<span class="photos-tidy-help">${esc(t)}</span>`;
      const doLine = t => `<p class="photos-tidy-line photos-tidy-do">${esc(t)}</p>`;
      // 맨 위: 언제 찾았나 · 몇 장 확인 · [다시 찾기](이 단추만 새로 찾는다).
      rows.push(`<p class="photos-tidy-at">${esc(foundText(st.at, now()))} · 폰 ${st.ph.length}장${st.odOn ? ` · 원드라이브 ${st.od.length}장` : ''} 확인${st.partial ? `(${SCAN_MAX}장까지만)` : ''}`
        + `${st.stale ? ' · 그 뒤 폰이 바뀌었어요' : ''} <button type="button" class="mini" data-photos-tidy-rescan>다시 찾기</button></p>`);
      if (st.gone > 0) rows.push(`<p class="photos-tidy-line photos-tidy-warn" role="alert">${esc(goneText(st.gone))} <button type="button" class="mini" data-photos-tidy-gone-ok>알았어요</button></p>`);
      // [나머지 지우기]도 원드라이브 사본이 확인된 사진만 지운다(원드라이브를 읽었을 때만 단추).
      const dupTrash = canTrash && st.odOn;
      // ① 어디에 있나
      if (st.odOn) {
        rows.push(`<div class="photos-tidy-row photos-tidy-places" role="group" aria-label="어디에 있나">${PLACES.map(p => {
          const n = p === 'all' ? '' : ` ${st.counts?.[p] ?? 0}`;
          return `<button type="button" class="photos-tidy-place" data-photos-place="${p}" aria-pressed="${p === placeOpen}">${PLACE_TEXT[p]}${n}</button>`;
        }).join('')}</div>`);
        rows.push(`<p class="photos-tidy-line">${esc(TIDY_HELP[placeOpen])}</p>`);
        if (placeOpen !== 'all') rows.push(pane('place:' + placeOpen));
      } else rows.push(`<p class="photos-tidy-line">어디에 있는지 거르기·백업 확인은 원드라이브 연결 뒤${st.odFailed ? `: ${esc(st.odFailed)}` : ''}</p>`);
      // ② 백업 안 됨(원드라이브에서 한 장도 못 찾은 폴더) + 일부만 있음(n/m장). 꺼 둔 폴더는 셈에서 빼고 [다시 켜기].
      if (st.odOn) {
        const on = st.unbacked.filter(f => !off.has(f.id)), offN = st.unbacked.length - on.length, n = on.reduce((s, f) => s + f.count, 0);
        const offBtn = f => (canHide ? `<button type="button" class="mini" data-photos-tidy-off="${esc(f.id)}">${off.has(f.id) ? '다시 켜기' : '폴더 끄기'}</button>` : '');
        const folderRow = (f, key, note, offOk = true) => `<div class="photos-tidy-junk"><span>📁 ${esc(f.name)} <span class="photos-tidy-num">${note}${f.bytes ? ' · ' + sizeText(f.bytes) : ''}${off.has(f.id) ? ' · 꺼짐' : ''}</span></span>`
          + `<button type="button" class="mini" data-photos-tidy-see="${esc(key)}" aria-expanded="${panes.has(key)}">보기</button>${offOk ? offBtn(f) : ''}<button type="button" class="mini" data-photos-tidy-folder="${esc(f.id)}">폴더</button></div>`
          + (panes.has(key) ? pane(key) : '');
        rows.push(st.unbacked.length || st.partly.length
          ? `<details class="photos-tidy-row" data-k="unbacked"><summary><span>백업 안 됨 <b>${on.length}개 폴더</b>${on.length ? ` · ${n}장` : ''}${offN ? ` · 꺼 둔 ${offN}개` : ''}${st.partly.length ? ` · 일부만 ${st.partly.length}개` : ''}`
            + `${help(TIDY_HELP.unbacked)}</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list">`
            + (st.unbacked.length ? doLine(TIDY_HELP.unbackedDo) : '')
            + st.unbacked.map(f => folderRow(f, 'unbacked:' + f.id, `${f.count}장`)).join('')
            + (st.partly.length ? doLine(TIDY_HELP.partly) + st.partly.map(f => folderRow(f, 'partly:' + f.id, partlyText(f), false)).join('') : '')
            + '</div></details>'
          : '<p class="photos-tidy-line">백업 안 됨 · 없음(폰 폴더마다 원드라이브에 같은 사진이 있어요)</p>');
      }
      // ③ 공간 비우기
      if (st.odOn && st.space) {
        const sp = st.space;
        rows.push(sp.items.length
          ? `<details class="photos-tidy-row" data-k="space"><summary><span>공간 비우기 · 폰에서만 지우면 <b>${sizeText(sp.bytes) || sp.items.length + '장'}</b> 비워져요${help(TIDY_HELP.space)}</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list">${doLine(TIDY_HELP.spaceDo)}<div class="photos-tidy-junk"><span>원드라이브에 있는 1년 지난 사진 ${sp.photos}장 · 큰 동영상 ${sp.videos}개(별표 뺌)</span>`
            + (canTrash ? '<button type="button" class="mini photos-danger" data-photos-tidy-trash="space">폰 공간만 비우기</button>' : '') + `</div>${pane('space')}</div></details>`
          : '<p class="photos-tidy-line">공간 비우기 · 후보 없음</p>');
      }
      // ④ 같은 사진·연사 묶음(S47-19B): 종류 칩으로 나눠 보고, 묶음을 열면(그 줄 안) 두 장씩 나란히 비교·남길 것 고르기.
      if (st.dups.length || simOn()) {
        const kind = dupKindOf(), all = dupStats(st.dups), mine = st.dups.filter(g => g.kind === kind), shown = shownDups(), stat = dupStats(mine);
        const sim = st.sim, simWait = kind === 'similar' && !sim.done;
        rows.push(`<details class="photos-tidy-row" data-k="dups"><summary><span>같은 사진·연사 <b>묶음 ${all.groups}개</b> · 지울 수 있는 ${all.extra}장${all.bytes ? ' · ' + sizeText(all.bytes) : ''}${help(TIDY_HELP.dups)}</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list">`
          + `<div class="photos-tidy-row photos-tidy-places" role="group" aria-label="묶음 종류">${Object.keys(DUP_TEXT).filter(k => k !== 'similar' || simOn()).map(k => {
            const n = st.dups.filter(g => g.kind === k).length;
            // 비슷한 사진은 누를 때 계산하므로 계산 전에는 숫자가 없고 늘 누를 수 있다.
            const label = k === 'similar' && !sim.done && !sim.running ? DUP_TEXT[k] : `${DUP_TEXT[k]} ${n}`;
            return `<button type="button" class="photos-tidy-place" data-photos-tidy-dupkind="${k}" aria-pressed="${k === kind}"${n || k === 'similar' ? '' : ' disabled'}>${label}</button>`;
          }).join('')}</div>`
          + `<p class="photos-tidy-line">${DUP_HOW[kind]} · ${dupStatText(stat)}</p>`
          + (simWait ? (sim.running ? `<p class="photos-tidy-line" data-photos-tidy-sim>비슷한 사진 비교 ${sim.count}/${st.simCand.length}장 ${waitInlineHtml()}</p>`
            : `<p class="photos-tidy-line" data-photos-tidy-sim>사진 ${st.simCand.length}장의 작은 그림을 비교해요 <button type="button" class="mini" data-photos-tidy-dupkind="similar">찾기</button></p>`) : '')
          + doLine(dupTrash ? TIDY_HELP.dupsDo : '묶음마다 남길 한 장을 고를 수 있어요 · 지우기는 원드라이브 연결·폰 휴지통이 있을 때만')
          + `<div class="photos-tidy-pane-head"><span class="photos-tidy-num">묶음마다 남길 사진을 누르세요(테두리 = 남김)</span>${chips('dups', DUP_SORTS)}</div>`
          + shown.map(g => {
            const keep = keepOf(g), key = 'dup:' + g.id, open = panes.has(key);
            return `<div class="photos-tidy-dup" data-photos-tidy-dup="${esc(g.id)}"><span class="photos-tidy-num">${DUP_TEXT[g.kind]} ${g.items.length}장${g.bytes ? ' · 아낄 ' + sizeText(g.bytes) : ''}</span>`
              + `<button type="button" class="mini" data-photos-tidy-see="${esc(key)}" aria-expanded="${open}">비교</button>`
              + (dupTrash ? `<button type="button" class="mini photos-danger" data-photos-tidy-trash="dup|${esc(g.id)}">나머지 지우기</button>` : '')
              + '<span class="photos-tidy-ths">'
              + g.items.slice(0, 8).map(p => `<button type="button" class="photos-tidy-pick" data-photos-tidy-keep="${esc(g.id)}|${esc(p.id)}" aria-pressed="${p.id === keep}" aria-label="${p.id === keep ? '남길 사진' : '이 사진 남기기'}"><span class="photos-tidy-th" data-photos-tidy-th="${esc(p.id)}"></span>${sizeText(p.size_bytes) ? `<span class="photos-tidy-size">${sizeText(p.size_bytes)}</span>` : ''}</button>`).join('')
              + `${g.items.length > 8 ? `<span class="photos-tidy-num">외 ${g.items.length - 8}장</span>` : ''}</span>`
              + (open ? cmpHtml(g, keep) : '') + '</div>';
          }).join('')
          + (mine.length > shown.length ? `<p class="photos-tidy-line">외 ${mine.length - shown.length}묶음(위 묶음을 정리하면 이어서 보여요)</p>` : '')
          + (dupTrash ? `<div class="photos-tidy-junk"><span>보이는 ${DUP_TEXT[kind]} 묶음에서 남길 사진만 두고</span><button type="button" class="mini photos-danger" data-photos-tidy-trash="dups">나머지 모두 지우기</button></div>` : '')
          + '</div></details>');
      }
      // ⑤ 잡동사니
      const junkN = st.junk.reduce((s, g) => s + g.items.length, 0), junkB = st.junk.reduce((s, g) => s + g.bytes, 0);
      rows.push(st.junk.length
        ? `<details class="photos-tidy-row" data-k="junk"><summary><span>잡동사니 <b>${junkN}장</b>${junkB ? ' · ' + sizeText(junkB) : ''}${help(TIDY_HELP.junk)}</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list">${doLine(TIDY_HELP.junkDo)}${st.junk.map(g => {
          const hidden = groupHidden(g, off), key = 'junk:' + g.kind;
          return `<div class="photos-tidy-junk"><span>${esc(g.label)} ${g.items.length}장${g.bytes ? ' · ' + sizeText(g.bytes) : ''}${hidden ? ' · 숨김' : ''}${help(JUNK_HELP[g.kind] || '')}</span>`
            + `<button type="button" class="mini" data-photos-tidy-see="${key}" aria-expanded="${panes.has(key)}">보기</button>`
            + (canHide && g.folders.length ? `<button type="button" class="mini" data-photos-tidy-hide="${g.kind}">${hidden ? '다시 보이기' : '숨기기'}</button>` : '')
            + (canTrash ? `<button type="button" class="mini photos-danger" data-photos-tidy-trash="${g.kind}">지우기</button>` : '')
            + '</div>' + (panes.has(key) ? pane(key) : '');
        }).join('')}</div></details>`
        : '<p class="photos-tidy-line">잡동사니 · 없음</p>');
      return rows.join('');
    },
  };
  return api;
}
