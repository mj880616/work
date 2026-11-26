// WEEKLY-내양식자유변형 ⑤-2·⑤-3: 한글 파일 엔진에 넘길 양식(profile)을 고른다. 코드에 박힌 기본 양식은 없다(⑤-3a).
//  - engineForm(rt): 바탕(확정본)을 열기 전에 저장된 '내 양식'을 읽는다. 던지지 않는다.
//      자리가 모두 붙은 양식 → 그 profile(status 'own').
//      저장된 양식 없음(none)·자리가 깨진 양식(broken)·표 준비 전(missing) → profile 없음. 부르는 쪽이 바탕 파일에서 읽는다(baseForm).
//      읽기 실패(readFailed) → profile 없음 + 한 줄 안내. 부르는 쪽은 바탕을 열지 않고 [다시 시도]를 보인다(기본값으로 몰래 돌지 않음).
//  - baseForm(pkg, draft)(사용자 결정 11/17 '나'): 바탕 파일에서 양식을 읽어(hwpx-form-read.mjs readBaseForm — 글자는 파일 그대로)
//      그 profile 로 바탕을 실제로 열어 본다(draft.prepareConfirmed). 읽지 못하거나 열리지 않으면 {note} 한 줄 — 추측해 열지 않는다.
//      그 주 바탕에 회의 결과 상자가 없으면 상자 칸 이름을 알 수 없어 그 자리에서만 쓰고 저장하지 않는다(savable false).
//  - saveBaseForm({form, known}, rt): 자료실 바탕에서 읽은 양식을 본인 로그인으로 자기 '내 양식'에 저장한다(owner RLS 그대로, 기존
//      saveOwnForm). known = 깨진 양식 행(있으면 그 행을 고침, 없으면 새로 넣음). 이미 다른 기기가 먼저 넣었으면(409·바뀜) 그대로 둔다.
//      같은 작업공간에서 저장 중·저장한 뒤에는 다시 보내지 않는다. 실패해도 화면은 읽은 양식으로 계속, 한 줄 안내.
// 브라우저 저장소 없음. 로그·오류에 양식 글자를 쓰지 않는다.
import {readOwnForm, saveOwnForm} from './weekly-own-form-store.js';
import {profileOf} from './weekly-hwpx/form-profile.mjs';
import {readBaseForm} from './hwpx-form-read.mjs';

// 화면 글(docs/design/ui-words.md). 상태 줄 한 줄.
export const ENGINE_FORM_TEXT = Object.freeze({
  readFailed: '내 양식을 읽지 못해 바탕을 열지 않았어요.',
  baseFailed: '바탕 파일에서 양식(항목 제목·표 칸)을 읽지 못해 열지 않았어요. 바탕 파일의 항목 차례나 표 모양이 주간 보고 양식과 달라요.',
  saveFailed: '바탕에서 읽은 양식을 내 양식으로 저장하지 못했어요. 다음에 열 때 다시 해요.',
});

// → {status:'own'|'none'|'missing'|'broken'|'readFailed', profile(own일 때만), row(broken일 때 그 행), note}
export async function engineForm(rt = window.KPTURuntime) {
  let read;
  try { read = await readOwnForm(rt); }
  catch { return {status: 'readFailed', profile: null, row: null, note: ENGINE_FORM_TEXT.readFailed}; }
  if (read.missing) return {status: 'missing', profile: null, row: null, note: ''};
  if (!read.row) return {status: 'none', profile: null, row: null, note: ''};
  const profile = profileOf(read.row.form);
  return profile ? {status: 'own', profile, row: read.row, note: ''} : {status: 'broken', profile: null, row: read.row, note: ''};
}

// 바탕 파일(열린 .hwpx 묶음) → {profile, form, savable, prepared} | {note}. draft = weekly-hwpx/draft.mjs(부르는 쪽이 lazy import).
export function baseForm(pkg, draft) {
  let read;
  try { read = readBaseForm(pkg); } catch { read = {reason: 'unreadable'}; }
  if (!read.form) return {note: ENGINE_FORM_TEXT.baseFailed, reason: read.reason};
  const profile = profileOf(read.form, {allowNoBoxes: true});
  if (!profile) return {note: ENGINE_FORM_TEXT.baseFailed, reason: 'items'};
  let prepared;
  try { prepared = draft.prepareConfirmed(pkg, {profile}); } catch { return {note: ENGINE_FORM_TEXT.baseFailed, reason: 'engine'}; }
  return {profile, form: read.form, savable: profile.boxLabels.length > 0, prepared};
}

const saving = new Map(); // 작업공간 → 저장 약속(한 번만)
const workspaceOf = rt => rt?.context?.read?.()?.workspace?.id ?? '';

// → {status:'saved'|'exists'|'missing'|'failed', note}
export function saveBaseForm({form, known = null}, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  if (!ws) return Promise.resolve({status: 'failed', note: ENGINE_FORM_TEXT.saveFailed});
  if (saving.has(ws)) return saving.get(ws);
  const job = (async () => {
    try {
      const r = await saveOwnForm(known?.id ? {known, name: known.name, sourceName: known.source_name ?? null, form} : {known: null, name: '', form}, rt);
      if (r.ok) return {status: 'saved', note: ''};
      if (r.missing) { saving.delete(ws); return {status: 'missing', note: ''}; }
      return {status: 'exists', note: ''}; // 그사이 다른 기기가 먼저 저장·고침 — 그것을 그대로 둔다
    } catch {
      saving.delete(ws); // 다음에 열 때 다시
      return {status: 'failed', note: ENGINE_FORM_TEXT.saveFailed};
    }
  })();
  saving.set(ws, job);
  return job;
}

// 시험용: 한 번 저장 기억 비우기(로그인 바뀜 등).
export function forgetSaved() { saving.clear(); }
