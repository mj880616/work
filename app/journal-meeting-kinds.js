// JOURNAL-회의종류표시: which kinds of meeting go into the weekly report (업무일지 [주간 정리] and the draft copy).
// A kind = the meeting's series_name (title when there is none) with spaces removed and lower-cased — the same rule as
// app/team.js meetingNameKey (a classic script, so the rule is repeated here and pinned by tests/journal-meeting-kinds.test.mjs).
// The list of kinds NOT to report lives in my own profile row (app_profiles.weekly_hidden_meeting_kinds, migration
// 20261022090000; default 궤도집행국회의·본부집행위). Anything not in the list is reported, so a new kind is reported by itself,
// and a list that cannot be read (an older answer, a failed read) means "report everything" — the screen never hides on a guess.
// Reads and writes go through the existing owner-RLS REST path (my profile row, this one column only).
export const KIND_MAX = 100;
export const KIND_LIST_MAX = 100;
const encode = encodeURIComponent;

export const meetingKindKey = name => String(name ?? '').replace(/\s+/g, '').toLowerCase();
export const meetingKindName = meeting => String(meeting?.series_name || meeting?.title || '').trim();
// What the database CHECK accepts for one kind: 1~100 characters, no space, comma or control character.
export const validKindKey = key => typeof key === 'string' && /^[^,\s\p{Cc}]+$/u.test(key) && [...key].length <= KIND_MAX;
// The column as the screen uses it: a clean list of keys, or null when the answer is not a valid list (then nothing is hidden).
export function parseKinds(value) {
  if (!Array.isArray(value) || value.length > KIND_LIST_MAX) return null;
  return value.every(validKindKey) && new Set(value).size === value.length ? [...value] : null;
}
// Whether a meeting goes into the weekly report. hidden = parseKinds() result; null → everything goes in.
export function reportsMeeting(meeting, hidden) {
  if (!hidden?.length) return true;
  const key = meetingKindKey(meetingKindName(meeting));
  return !key || !hidden.includes(key);
}
// The list after turning one kind off (hide) or on (show). Order is kept; no kind twice; null when the change cannot be written.
export function withKind(hidden, key, hide) {
  if (!validKindKey(key) || !Array.isArray(hidden)) return null;
  const rest = hidden.filter(k => k !== key);
  const next = hide ? [...rest, key] : rest;
  return next.length <= KIND_LIST_MAX ? next : null;
}

const profileUrl = rt => {
  const user = rt?.context?.read?.()?.user?.id;
  return user ? `/rest/v1/app_profiles?user_id=eq.${encode(user)}` : '';
};
// Reads my list: {status:'ok', list} or {status:'unknown'} (no profile row, no such column yet, a failed read).
export async function readKinds(rt = window.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url) return {status:'unknown'};
  try {
    const rows = await rt.api(`${url}&select=weekly_hidden_meeting_kinds&limit=1`);
    const list = Array.isArray(rows) ? parseKinds(rows[0]?.weekly_hidden_meeting_kinds) : null;
    return list ? {status:'ok', list} : {status:'unknown'};
  } catch { return {status:'unknown'}; }
}
// Turns one kind off/on in my profile row. The list is read again right before writing so a change made on another device is kept;
// only this column is sent. Returns {ok:true, list} or {ok:false}.
export async function changeKind(key, hide, rt = window.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url || !validKindKey(key)) return {ok:false};
  try {
    const fresh = await readKinds(rt);
    if (fresh.status !== 'ok') return {ok:false};
    const next = withKind(fresh.list, key, hide);
    if (!next) return {ok:false};
    if (next.length === fresh.list.length && next.every((k, i) => k === fresh.list[i])) return {ok:true, list:next};
    const saved = await rt.api(url, {method:'PATCH', prefer:'return=representation', body:{weekly_hidden_meeting_kinds:next}});
    const list = Array.isArray(saved) && saved.length === 1 ? parseKinds(saved[0]?.weekly_hidden_meeting_kinds) : null;
    return list ? {ok:true, list} : {ok:false};
  } catch { return {ok:false}; }
}
