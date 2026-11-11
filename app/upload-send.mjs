// UI-올리기진행표시(S52-15): 파일을 서버로 보내는 길 하나. fetch는 보낸 양을 알려 주지 않으므로 XMLHttpRequest의
// upload.onprogress(브라우저가 실제로 보낸 바이트)로 보낸 양을 알린다. 가짜로 움직이는 값은 만들지 않는다.
// 시간 한도는 upload-budget.mjs(파일 크기 기준) 한 곳. 기기에 아무것도 저장하지 않는다.
//   sendUpload(url, {headers, body, size, signal, onProgress}) → {ok, status, text}
//   onProgress({loaded, total, phase}) — phase 'sending'(보내는 중) | 'finishing'(다 보냈고 서버 답을 기다림 = 서버가 Drive에 넣는 단계)
// 실패 code: 'upload_cancelled'(✕, 다 보내기 전 — 서버는 파일을 받지 못함), 'upload_not_sent'(다 보내기 전에 연결이 끊김 — 받지 못함),
// 'upload_timeout_sending'(한도 안에 다 못 보냄 — 받지 못함), 'note_save_result_unknown'(다 보낸 뒤 답이 없음 — 저장됐을 수 있음).
import {uploadTimeoutMs} from './upload-budget.mjs';

// via: 'error'(연결 끊김) | 'timeout'(시간 한도) — 부르는 곳이 지금까지의 문구(끊김/시간 초과)를 고를 수 있게.
const failure = (message, code, status = 0, via = '') => Object.assign(new Error(message), {code, status, ...(via ? {via} : {})});

export function sendUpload(url, {method = 'POST', headers = {}, body, size = 0, timeoutMs = uploadTimeoutMs(size), signal = null, onProgress = () => {}, Xhr = globalThis.XMLHttpRequest, fetcher = globalThis.fetch} = {}) {
  const tell = value => { try { onProgress(value); } catch { /* 표시가 올리기를 멈추게 하지 않는다 */ } };
  if (signal?.aborted) return Promise.reject(failure('올리기를 취소했어요.', 'upload_cancelled'));
  if (typeof Xhr !== 'function') return sendByFetch(url, {method, headers, body, size, timeoutMs, signal, tell, fetcher});
  return new Promise((resolve, reject) => {
    const xhr = new Xhr();
    let sent = 0, whole = Number(size) || 0, finishing = false, settled = false;
    const end = (fn, value) => { if (settled) return; settled = true; signal?.removeEventListener?.('abort', onAbort); fn(value); };
    const notSent = () => !finishing && (!whole || sent < whole);
    function onAbort() {
      if (finishing) return; // 다 보낸 뒤에는 서버가 이미 받았을 수 있으므로 끊지 않는다(✕도 이때는 보이지 않음).
      try { xhr.abort(); } catch { /* 이미 끝남 */ }
      end(reject, failure('올리기를 취소했어요.', 'upload_cancelled'));
    }
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) if (value != null) xhr.setRequestHeader(name, value);
    if (Number(timeoutMs) > 0) xhr.timeout = Number(timeoutMs);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && e.total > 0) whole = e.total;
      sent = Math.max(sent, Number(e.loaded) || 0);
      if (whole && sent >= whole) finishing = true;
      tell({loaded: sent, total: whole, phase: finishing ? 'finishing' : 'sending'});
    };
    xhr.upload.onload = () => { finishing = true; sent = whole = Math.max(whole, sent); tell({loaded: sent, total: whole, phase: 'finishing'}); };
    xhr.onload = () => end(resolve, {ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: String(xhr.responseText ?? '')});
    xhr.onerror = () => end(reject, notSent() ? failure('연결이 끊겨 다 보내지 못했어요.', 'upload_not_sent', 0, 'error') : failure('저장 결과를 확인하지 못했어요.', 'note_save_result_unknown', 0, 'error'));
    xhr.ontimeout = () => end(reject, notSent() ? failure('너무 오래 걸려 다 보내지 못했어요.', 'upload_timeout_sending', 0, 'timeout') : failure('저장 결과를 확인하지 못했어요.', 'note_save_result_unknown', 0, 'timeout'));
    xhr.onabort = () => end(reject, failure('올리기를 취소했어요.', 'upload_cancelled'));
    signal?.addEventListener?.('abort', onAbort, {once: true});
    tell({loaded: 0, total: whole, phase: 'sending'});
    xhr.send(body);
  });
}

// XMLHttpRequest가 없는 곳(시험 환경): 보낸 양은 끝에서 한 번만 알 수 있다.
async function sendByFetch(url, {method, headers, body, size, timeoutMs, signal, tell, fetcher}) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(failure('저장 결과를 확인하지 못했어요.', 'note_save_result_unknown')), timeoutMs); });
  try {
    tell({loaded: 0, total: size, phase: 'sending'});
    const response = await Promise.race([fetcher(url, {method, headers, body}), deadline]);
    tell({loaded: size, total: size, phase: 'finishing'});
    const text = await Promise.race([response.text(), deadline]);
    return {ok: response.ok, status: response.status, text};
  } finally { clearTimeout(timer); void signal; }
}

// 보낸 양 줄: '3.4MB / 8.1MB'. 1024 단위(바구니 첨부 줄과 같은 표기).
export const amount = bytes => {
  const n = Math.max(0, Number(bytes) || 0);
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`;
};
// 실제로 보낸 양으로만 %를 셈(0~100, 내림 — 다 보내기 전에는 100%를 쓰지 않는다).
export const percent = (loaded, total) => total > 0 ? Math.min(100, Math.floor((Math.max(0, loaded) / total) * 100)) : 0;

// UI-올리기진행표시 ②: 공용 runtime.api(fetch, 보낸 양 모름)로 파일을 보내던 곳(할 일 첨부·회의 파일)이 같은 결과 모양으로 쓰는 길.
// runtime.api와 같게: 로그인 확인 → apikey·Bearer → 401이면 한 번만 새 로그인으로 다시 → JSON → 실패는 RuntimeError(status, code 'http_'+status).
// 보내기는 sendUpload(실제 보낸 양을 job.progress로). 성공하면 runtime.api처럼 kptu:api-saved(경로·방법만, 내용 없음)를 한 번 알린다.
export async function sendUploadApi(rt, path, {body, size = 0, job = null, timeoutMs, Xhr, fetcher} = {}) {
  const fail = (message, options) => rt?.RuntimeError ? new rt.RuntimeError(message, options) : Object.assign(new Error(message), {status: 0, retryable: false, ...options});
  const sessionRequired = () => fail('로그인이 필요합니다.', {status: 401, code: 'session_required'});
  if (!(await rt.session.ensure())) throw sessionRequired();
  const epoch = rt.session.epoch?.() ?? 0, url = path.startsWith('http') ? path : rt.config.url + path;
  const send = () => {
    const token = rt.session.read()?.access_token;
    if (!token) throw sessionRequired();
    return sendUpload(url, {headers: {apikey: rt.config.key, Authorization: 'Bearer ' + token}, body, size, signal: job?.signal || null, onProgress: job?.progress || (() => {}),
      ...(timeoutMs != null ? {timeoutMs} : {}), ...(Xhr !== undefined ? {Xhr} : {}), ...(fetcher ? {fetcher} : {})});
  };
  let response = await send();
  if (response.status === 401) {
    if (!(await rt.session.refresh?.())) throw sessionRequired();
    response = await send();
    if (response.status === 401) { rt.session.write?.(null); throw sessionRequired(); }
  }
  let data; try { data = response.text ? JSON.parse(response.text) : null; } catch { data = response.text; }
  if (!response.ok) {
    const error = fail(data?.message || data?.error_description || data?.hint || data?.error || ('요청 실패 ' + response.status), {status: response.status, code: 'http_' + response.status, retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500});
    // 서버가 답한 까닭 코드(예: attach_result_unknown)는 따로 둔다 — 결과를 알 수 없는 실패만 골라 다시 보내지 않게(할 일 첨부 뒤 줄, S59-18).
    if (typeof data?.code === 'string' && data.code) try { error.serverCode = data.code; } catch { /* 읽기 전용 오류 객체면 그대로 */ }
    throw error;
  }
  if (epoch === (rt.session.epoch?.() ?? 0) && data?.ok !== false && !data?.error) {
    try { globalThis.window?.dispatchEvent(new CustomEvent('kptu:api-saved', {detail: {path, method: 'POST', fields: [], action: '', projectLinked: !!(body?.get?.('project_id') || data?.document?.project_id), epoch}})); } catch { /* 알림을 듣는 곳이 저장 결과를 바꾸지 않는다 */ }
  }
  return data;
}
