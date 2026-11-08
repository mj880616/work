// S53-20 MTG-비정기회의접기: 회의명 정리(app_profiles.meeting_name_sorts, migration 20261108090000) 읽기·쓰기 한 곳.
// 내 프로필 행 이 칸만 기존 owner RLS REST로 읽고 쓴다(journal-meeting-kinds.js와 같은 방식, 새 표·함수 없음). 뜻은 meeting-name-sorts.mjs.
// 칸이 아직 없는 서버(적용 전)·읽기 실패면 {status:'unknown'} — 화면은 모든 회의명을 지금처럼 펼쳐 보이고 정리 메뉴는 안내만 한다.
// 쓰기는 바로 전에 다시 읽어 다른 기기에서 바꾼 정리를 덮지 않는다. 바뀌면 kptu:meeting-name-sorts 알림(고르는 창·목록이 다시 그림).
import {parseSorts, toStored} from './meeting-name-sorts.mjs';

const encode = encodeURIComponent;
let cache = null, flight = null;
const profileUrl = rt => {
  const user = rt?.context?.read?.()?.user?.id;
  return user ? `/rest/v1/app_profiles?user_id=eq.${encode(user)}` : '';
};
export const peekSorts = () => cache;
export async function readSorts(rt = window.KPTURuntime, {fresh = false} = {}) {
  if (!fresh && cache?.status === 'ok') return cache;
  if (!fresh && flight) return flight;
  const url = profileUrl(rt);
  if (!url) return {status: 'unknown'};
  const run = (async () => {
    try {
      const rows = await rt.api(`${url}&select=meeting_name_sorts&limit=1`);
      // 칸이 답에 없으면(칸이 아직 없는 서버의 옛 답) 모름 — 빈 정리로 보지 않는다.
      const sorts = Array.isArray(rows) && rows.length === 1 && rows[0] && 'meeting_name_sorts' in rows[0] ? parseSorts(rows[0].meeting_name_sorts) : null;
      cache = sorts ? {status: 'ok', sorts} : {status: 'unknown'};
    } catch { cache = {status: 'unknown'}; }
    return cache;
  })();
  flight = run; try { return await run; } finally { if (flight === run) flight = null; }
}
// change(sorts) → 새 sorts 또는 null(바꿀 수 없음). 돌려줌: {ok:true, sorts} | {ok:false, reason}.
export async function changeSorts(change, rt = window.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url) return {ok: false, reason: 'unknown'};
  try {
    const now = await readSorts(rt, {fresh: true});
    if (now.status !== 'ok') return {ok: false, reason: 'unknown'};
    const next = change(now.sorts);
    if (!next) return {ok: false, reason: 'invalid'};
    const stored = toStored(next);
    if (!stored) return {ok: false, reason: 'full'};
    const saved = await rt.api(url, {method: 'PATCH', prefer: 'return=representation', body: {meeting_name_sorts: stored}});
    const sorts = Array.isArray(saved) && saved.length === 1 ? parseSorts(saved[0]?.meeting_name_sorts) : null;
    if (!sorts) return {ok: false, reason: 'unknown'};
    cache = {status: 'ok', sorts};
    window.dispatchEvent(new CustomEvent('kptu:meeting-name-sorts'));
    return {ok: true, sorts};
  } catch { return {ok: false, reason: 'failed'}; }
}
export const failText = reason => reason === 'unknown' ? '회의명 정리는 아직 준비 중이에요. 잠시 뒤 다시 해 주세요.'
  : reason === 'full' ? '정리한 회의명이 너무 많아요. 안 쓰는 정리를 정기로 돌려 주세요.' : '저장하지 못했어요. 다시 해 주세요.';
