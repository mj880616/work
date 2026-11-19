// WEEKLY-재료전체 ② (S67-07): [주간 정리]를 열면 그 주 기록에 붙은 사진 가운데 설명이 없는 것(최근 것부터 PHOTO_BRIEF_BATCH장)을
// 서버(library-files action=photo-brief)가 AI로 읽어 '자료별 AI 요약 표'('b1:' 행 — 새 저장소 없음)에 짧은 설명을 남긴다.
// 서버가 내 로그인·내 작업공간 자료만 읽고, 하루 상한·이번 달 AI 한도를 지킨다. 화면은 숫자({done})만 받는다(설명 글은 자료 읽기로 다시 읽음).
// 실패해도 화면·주간 정리는 그대로(사진 줄은 파일 이름으로 남음). 같은 주는 한 방문에 한 번만 묻는다.
export const PHOTO_BRIEF_BATCH = 4;
export const PHOTO_BRIEF_TIMEOUT_MS = 60000;
export async function requestPhotoBriefs(ids, rt = window.KPTURuntime, {fetcher = globalThis.fetch, timeoutMs = PHOTO_BRIEF_TIMEOUT_MS} = {}) {
  const list = [...new Set((ids || []).filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, PHOTO_BRIEF_BATCH);
  if (!list.length) return {done:0};
  let timer = null;
  try {
    if (typeof rt?.session?.ensure === 'function' && !(await rt.session.ensure())) return {done:0};
    const token = rt?.session?.read?.()?.access_token;
    if (!token || !rt?.config?.url) return {done:0};
    const ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetcher(rt.config.url + '/functions/v1/library-files', {method:'POST', cache:'no-store', signal:ctl.signal,
      headers:{apikey:rt.config.key, Authorization:'Bearer ' + token, 'Content-Type':'application/json'}, body:JSON.stringify({action:'photo-brief', document_ids:list})});
    if (!r?.ok) return {done:0};
    const d = await r.json().catch(() => null);
    return {done:Number.isSafeInteger(d?.done) && d.done > 0 ? d.done : 0};
  } catch { return {done:0}; }
  finally { if (timer) clearTimeout(timer); }
}
