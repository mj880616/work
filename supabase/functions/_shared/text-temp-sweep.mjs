// S69-40(사용자 11/24: 드라이브 '자료실' 맨 위에 'Web2 글자 읽기 임시' 문서가 여러 개 남음): 글자 읽기(document-text convert)가 만든
// 임시 사본(appProperties web2_text_tmp=1)은 끝나면 지우지만, 서버가 도중에 끊기면(시간 초과·연결 끊김) 지우는 줄까지 가지 못해 남는다.
// 그래서 다음 글자 읽기 때 '만든 지 15분이 지난' 표식 사본을 찾아 드라이브 휴지통으로 보낸다(영구 삭제 아님, 30일 안 되돌리기 가능).
// 이 앱이 만든 표식 사본만 찾는다(이름만 같은 사람 파일은 건드리지 않음). 내용은 열지 않는다. DOM·Deno 없음(시험 tests/text-temp-sweep.test.mjs).
export const TEXT_TEMP_KEY = 'web2_text_tmp';
export const TEXT_TEMP_NAME = 'Web2 글자 읽기 임시';
export const SWEEP_AFTER_MS = 15 * 60 * 1000;
export const SWEEP_MAX = 20;
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export function sweepQuery(nowMs, afterMs = SWEEP_AFTER_MS) {
  const before = new Date(nowMs - afterMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `appProperties has { key='${TEXT_TEMP_KEY}' and value='1' } and trashed = false and createdTime < '${before}'`;
}

/**
 * 오래된 표식 사본을 휴지통으로. 답: 보낸 수. 실패해도 throw하지 않는다(글자 읽기를 막지 않음).
 * @param {{fetch?: typeof globalThis.fetch, token?: string, now?: () => number, max?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<number>}
 */
export async function sweepTextTemps({ fetch: doFetch = globalThis.fetch, token, now = Date.now, max = SWEEP_MAX, timeoutMs = 8000 } = {}) {
  if (!token) return 0;
  const auth = { Authorization: `Bearer ${token}` };
  let trashed = 0;
  try {
    const q = new URLSearchParams({ q: sweepQuery(now()), fields: 'files(id,appProperties)', pageSize: String(max), spaces: 'drive' });
    const r = await doFetch(`${DRIVE}?${q}`, { headers: auth, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) { await r.body?.cancel?.().catch(() => {}); return 0; }
    const d = await r.json().catch(() => null);
    for (const f of Array.isArray(d?.files) ? d.files.slice(0, max) : []) {
      if (!DRIVE_ID.test(String(f?.id || '')) || f?.appProperties?.[TEXT_TEMP_KEY] !== '1') continue;
      const p = await doFetch(`${DRIVE}/${encodeURIComponent(f.id)}?fields=id`, {
        method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null);
      if (p?.ok) trashed++;
      await p?.body?.cancel?.().catch(() => {});
    }
  } catch { /* 다음 번에 다시 */ }
  return trashed;
}
