// APP-기록+이름바꾸기(S67-44) · S67-71: '내가 고친 이름'(내 프로필 행 app_profiles.custom_words, owner RLS)을 읽고 쓰는 유일한 길.
// 고치는 화면은 '메뉴 수정' 창(menu-edit.js) 하나다(S71-32: 내 프로필 '이름 바꾸기' 상자는 없앴다).
// 기기에는 남기지 않는다. 칸이 아직 없는 서버(DB 적용 전)는 읽기가 400(err.status 그대로 올린다).
import {parseCustomWords, buildSaveValue} from './brand/custom-words-model.mjs';

const userOf = rt => rt?.context?.read?.()?.user?.id || rt?.session?.read?.()?.user?.id || '';
const profileUrl = userId => `/rest/v1/app_profiles?user_id=eq.${encodeURIComponent(userId)}`;

/** 서버에서 지금 값을 읽는다 → {userId, saved}(saved = {칸 id: 이름}). */
export async function readCustomWords(rt = window.KPTURuntime) {
  const userId = userOf(rt);
  if (!userId) throw new Error('no_user');
  const rows = await rt.api(`${profileUrl(userId)}&select=custom_words&limit=1`, {singleFlight: false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('no_row');
  return {userId, saved: parseCustomWords(rows[0]?.custom_words)};
}

/** 저장할 값(buildSaveValue의 value, null = 모두 기본)을 내 행에 쓴다 → 서버가 돌려준 saved. */
export async function writeCustomWords(rt = window.KPTURuntime, userId, value) {
  const rows = await rt.api(profileUrl(userId), {method: 'PATCH', prefer: 'return=representation', body: {custom_words: value}, singleFlight: false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('not_saved');
  return parseCustomWords(rows[0]?.custom_words);
}

/**
 * 고친 칸들만 바꾼다(메뉴 수정 [완료]). 바로 전에 서버 값을 다시 읽어 다른 칸은 그대로 두고 이 칸들만 갈아 끼운다. 빈칸 = 기본 이름.
 * changes = {칸 id: 이름}. → {saved}(바뀐 뒤 값) 또는 {error: 칸 id | 'size'}(저장하지 않음).
 */
export async function saveCustomWords(rt = window.KPTURuntime, face, changes) {
  const {userId, saved} = await readCustomWords(rt);
  const merged = {...saved};
  for (const [slotId, name] of Object.entries(changes || {})) merged[slotId] = typeof name === 'string' ? name : '';
  const next = buildSaveValue(face, merged);
  if (next.error) return {error: next.error};
  return {saved: await writeCustomWords(rt, userId, next.value)};
}
