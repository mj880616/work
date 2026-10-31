// S46-20 사진 정리 제안 ①(요청함 10/31 11:04, 시안 확정 10/31 13:2x): 사진 메뉴 위 [정리 n] 칩 → 접힌 칸.
// ① 거르기 줄 [전체|폰에만|원드라이브에만|둘 다] ② 백업 안 됨 n개 폴더 ⑤ 잡동사니(1년 지난 스크린샷·카톡·텔레그램 받은 사진) n장.
// 줄마다 한 줄 요약 + [보기](<details>). 지우기·숨기기는 명진이 눌러야만(폰 휴지통은 시스템 확인 창도). 자동 삭제 없음.
// - 재료: 폰 사진 전부(앱 다리, 끈 폴더 포함)와 원드라이브 사진 전부(서버 library, 고른 폴더 색인). [정리]를 처음 누를 때 읽는다.
//   사진·목록은 이 화면 메모리에만 있고 기기·서버에 저장하지 않는다(폰 사진은 서버로 올라가지 않는다).
// - 규칙은 photo-tidy-model.mjs(같은 사진 판정은 섞어 보기 규칙 그대로).
import {matchIndex, placeItems, placeCounts, unbackedFolders, junkGroups, groupHidden, tidyCount, forgetIds, sizeText, PLACES, PLACE_TEXT, SCAN_MAX,
  spacePlan, dupGroups, dupTrashList, scanFresh, DUP_TEXT} from './photo-tidy-model.mjs';

const PAGE = 200;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createPhotoTidy({phone, readOd, odReady, odError, phoneError, phoneOff, onChange, isStarred = () => false, now = () => Date.now()}) {
  let st = null, token = 0;
  const keeps = new Map(); // ④ 명진이 고른 남길 것(묶음 id → 칸 id), 이 화면 메모리만
  const empty = () => ({running:false, done:false, partial:false, failed:'', odFailed:'', od:[], ph:[], odOn:false, index:null, unbacked:[], junk:[], counts:null, space:null, dups:[], at:0});
  const changed = () => { try { onChange?.(); } catch { /* 화면 다시 그리기 실패가 읽기를 막지 않게 */ } };
  function derive() {
    if (!st) return;
    st.index = matchIndex(st.od, st.ph);
    st.unbacked = st.odOn ? unbackedFolders(st.ph, st.index) : [];
    st.junk = junkGroups(st.ph);
    st.counts = st.odOn ? placeCounts({odItems:st.od, phItems:st.ph, index:st.index, off:phoneOff()}) : null;
    st.space = st.odOn ? spacePlan(st.ph, st.index, {now:now(), isStarred}) : null;
    st.dups = dupGroups(st.ph);
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
    st = {...empty(), running:true, odOn:odReady()};
    changed();
    const jobs = [scanPhone(t).catch(e => { if (t === token) st.failed = phoneError(e); })];
    if (st.odOn) jobs.push(scanOd(t).catch(e => { if (t === token) { st.odFailed = odError(e); st.odOn = false; } }));
    await Promise.all(jobs);
    if (t !== token) return;
    st.running = false; st.done = !st.failed; st.at = now();
    derive(); changed();
  }
  const ready = () => !!st?.done;
  const api = {
    get state() { return st; },
    ready,
    // 처음 열 때만 읽는다(다시 확인은 [다시 확인]).
    open() { if (!st) scan(); },
    rescan: () => scan(),
    reset() { token++; st = null; keeps.clear(); },
    // 끈 폴더가 바뀌면 장수만 다시.
    offChanged() { if (ready()) { derive(); } },
    count: () => (ready() ? tidyCount(st, phoneOff()) + (st.space?.items.length ? 1 : 0) + (st.dups.length ? 1 : 0) : 0),
    // ③ 지우기 전: 읽은 지 10분 안이어야 한다(아니면 다시 확인).
    fresh: () => ready() && scanFresh(st.at, now()),
    item: id => (st ? st.ph.find(p => p.id === id) || null : null),
    unbackedIds: () => new Set(ready() ? st.unbacked.map(f => f.id) : []),
    // 보기 목록: 'place:phone' · 'junk:kakao'. 없으면 null.
    list(key) {
      if (!ready()) return null;
      const [kind, name] = String(key || '').split(':');
      if (kind === 'place' && st.odOn && PLACES.includes(name) && name !== 'all') return placeItems(name, {odItems:st.od, phItems:st.ph, index:st.index, off:phoneOff()});
      if (kind === 'junk') return st.junk.find(g => g.kind === name)?.items.slice() || null;
      if (kind === 'space') return st.space?.items.length ? st.space.items.slice() : null;
      return null;
    },
    label(key) {
      const [kind, name] = String(key || '').split(':');
      if (kind === 'place') return PLACE_TEXT[name] || '';
      if (kind === 'space') return '공간 비우기 후보';
      return st?.junk.find(g => g.kind === name)?.label || '';
    },
    group(kind) {
      if (!ready()) return null;
      if (kind === 'space') return st.space?.items.length ? {kind, label:'원드라이브에 있는 폰 사진', items:st.space.items.slice(), folders:[]} : null;
      if (kind === 'dups') { const items = dupTrashList(st.dups.slice(0, 40), keeps); /* 화면에 보인 묶음만 */ return items.length ? {kind, label:'같은 사진 묶음의 남기지 않을 사진', items, folders:[]} : null; }
      if (kind.startsWith('dup|')) { const g = st.dups.find(x => x.id === kind.slice(4)); const items = g ? dupTrashList([g], keeps) : []; return items.length ? {kind, label:`${DUP_TEXT[g.kind]} 묶음의 남기지 않을 사진`, items, folders:[]} : null; }
      return st.junk.find(g => g.kind === kind) || null;
    },
    // ④ 남길 것 고르기.
    keep(groupId, itemId) { const g = st?.dups.find(x => x.id === groupId); if (g && g.items.some(p => p.id === itemId)) keeps.set(groupId, itemId); },
    // 지운 칸(폰 휴지통·원드라이브 휴지통 뒤)을 재료에서 뺀다.
    forget(ids) {
      if (!st || !ids?.length) return;
      st.od = forgetIds(st.od, ids); st.ph = forgetIds(st.ph, ids);
      if (ready()) derive();
    },
    // 접힌 칸 HTML. place = 지금 거르기, canHide = 폰 폴더 스위치를 쓸 수 있음(앱 0.4.1+), canTrash = 폰 휴지통.
    html({place = 'all', canHide = false, canTrash = false} = {}) {
      if (!st) return '';
      if (st.running) return `<p class="photos-tidy-line" role="status">사진 확인 중 · 폰 ${st.ph.length}장${st.odOn ? ` · 원드라이브 ${st.od.length}장` : ''}</p>`;
      if (st.failed) return `<p class="photos-tidy-line">${esc(st.failed)} <button type="button" class="mini" data-photos-tidy-rescan>다시</button></p>`;
      const off = phoneOff(), rows = [];
      // ① 어디에 있나
      if (st.odOn) {
        rows.push(`<div class="photos-tidy-row photos-tidy-places" role="group" aria-label="어디에 있나">${PLACES.map(p => {
          const n = p === 'all' ? '' : ` ${st.counts?.[p] ?? 0}`;
          return `<button type="button" class="photos-tidy-place" data-photos-place="${p}" aria-pressed="${p === place}">${PLACE_TEXT[p]}${n}</button>`;
        }).join('')}</div>`);
      } else rows.push(`<p class="photos-tidy-line">어디에 있는지 거르기·백업 확인은 원드라이브 연결 뒤${st.odFailed ? `: ${esc(st.odFailed)}` : ''}</p>`);
      // ② 백업 안 됨
      if (st.odOn) {
        const n = st.unbacked.reduce((s, f) => s + f.count, 0);
        rows.push(st.unbacked.length
          ? `<details class="photos-tidy-row" data-k="unbacked"><summary><span>백업 안 됨 <b>${st.unbacked.length}개 폴더</b> · ${n}장</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list">${st.unbacked.map(f =>
            `<button type="button" class="photos-tidy-item" data-photos-tidy-folder="${esc(f.id)}"><span>📁 ${esc(f.name)}</span><span class="photos-tidy-num">${f.count}장${f.bytes ? ' · ' + sizeText(f.bytes) : ''}${off.has(f.id) ? ' · 꺼짐' : ''}</span></button>`).join('')}</div></details>`
          : '<p class="photos-tidy-line">백업 안 됨 · 없음(폰 폴더마다 원드라이브에 같은 사진이 있어요)</p>');
      }
      // ③ 공간 비우기
      if (st.odOn && st.space) {
        const sp = st.space;
        rows.push(sp.items.length
          ? `<details class="photos-tidy-row" data-k="space"><summary><span>공간 비우기 · 폰에서만 지우면 <b>${sizeText(sp.bytes) || sp.items.length + '장'}</b> 비워져요</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list"><div class="photos-tidy-junk"><span>원드라이브에 있는 1년 지난 사진 ${sp.photos}장 · 큰 동영상 ${sp.videos}개(별표 뺌)</span>`
            + '<button type="button" class="mini" data-photos-tidy-see="space">보기</button>'
            + (canTrash ? '<button type="button" class="mini photos-danger" data-photos-tidy-trash="space">폰에서만 지우기</button>' : '') + '</div></div></details>'
          : '<p class="photos-tidy-line">공간 비우기 · 후보 없음</p>');
      }
      // ④ 같은 사진 묶음
      if (st.dups.length) {
        const shown = st.dups.slice(0, 40), bytes = st.dups.reduce((n, g) => n + g.bytes, 0);
        rows.push(`<details class="photos-tidy-row" data-k="dups"><summary><span>같은 사진 묶음 <b>${st.dups.length}개</b>${bytes ? ' · ' + sizeText(bytes) : ''}</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list">`
          + '<p class="photos-tidy-line">묶음마다 남길 사진을 누르세요(테두리 = 남김).</p>'
          + shown.map(g => {
            const keep = g.items.some(p => p.id === keeps.get(g.id)) ? keeps.get(g.id) : g.keep;
            return `<div class="photos-tidy-dup" data-photos-tidy-dup="${esc(g.id)}"><span class="photos-tidy-num">${DUP_TEXT[g.kind]} ${g.items.length}장${g.bytes ? ' · ' + sizeText(g.bytes) : ''}</span><span class="photos-tidy-ths">`
              + g.items.slice(0, 8).map(p => `<button type="button" class="photos-tidy-pick" data-photos-tidy-keep="${esc(g.id)}|${esc(p.id)}" aria-pressed="${p.id === keep}" aria-label="${p.id === keep ? '남길 사진' : '이 사진 남기기'}"><span class="photos-tidy-th" data-photos-tidy-th="${esc(p.id)}"></span></button>`).join('')
              + `${g.items.length > 8 ? `<span class="photos-tidy-num">외 ${g.items.length - 8}장</span>` : ''}</span>`
              + (canTrash ? `<button type="button" class="mini photos-danger" data-photos-tidy-trash="dup|${esc(g.id)}">나머지 지우기</button>` : '') + '</div>';
          }).join('')
          + (st.dups.length > shown.length ? `<p class="photos-tidy-line">외 ${st.dups.length - shown.length}묶음(위 묶음을 정리하면 이어서 보여요)</p>` : '')
          + (canTrash ? '<div class="photos-tidy-junk"><span>모든 묶음에서 남길 사진만 두고</span><button type="button" class="mini photos-danger" data-photos-tidy-trash="dups">나머지 모두 지우기</button></div>' : '')
          + '</div></details>');
      }
      // ⑤ 잡동사니
      const junkN = st.junk.reduce((s, g) => s + g.items.length, 0), junkB = st.junk.reduce((s, g) => s + g.bytes, 0);
      rows.push(st.junk.length
        ? `<details class="photos-tidy-row" data-k="junk"><summary><span>잡동사니 <b>${junkN}장</b>${junkB ? ' · ' + sizeText(junkB) : ''}</span><span class="photos-tidy-see">보기</span></summary><div class="photos-tidy-list">${st.junk.map(g => {
          const hidden = groupHidden(g, off);
          return `<div class="photos-tidy-junk"><span>${esc(g.label)} ${g.items.length}장${g.bytes ? ' · ' + sizeText(g.bytes) : ''}${hidden ? ' · 숨김' : ''}</span>`
            + `<button type="button" class="mini" data-photos-tidy-see="${g.kind}">보기</button>`
            + (canHide && g.folders.length ? `<button type="button" class="mini" data-photos-tidy-hide="${g.kind}">${hidden ? '다시 보이기' : '숨기기'}</button>` : '')
            + (canTrash ? `<button type="button" class="mini photos-danger" data-photos-tidy-trash="${g.kind}">지우기</button>` : '')
            + '</div>';
        }).join('')}</div></details>`
        : '<p class="photos-tidy-line">잡동사니 · 없음</p>');
      rows.push(`<p class="photos-tidy-foot">폰 ${st.ph.length}장${st.odOn ? ` · 원드라이브 ${st.od.length}장` : ''} 확인${st.partial ? `(${SCAN_MAX}장까지만)` : ''} · <button type="button" class="mini" data-photos-tidy-rescan>다시 확인</button></p>`);
      return rows.join('');
    },
  };
  return api;
}
