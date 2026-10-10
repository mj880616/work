(() => {
  'use strict';

  // Phone path B: review this source before the user runs the bookmark.
  // No runtime.api/ensure/refresh: those may retry or call other endpoints.
  const panelId = 'library-upload-diag-panel';
  const existing = document.getElementById(panelId);
  if (existing) { existing.focus(); return; }
  const paths = {
    library: '/functions/v1/library-files',
    meeting: '/functions/v1/meeting-files'
  };
  const limitMs = 60000;
  // A page-wide non-secret flight marker survives panel close/reopen. Aborting
  // a Promise does not prove that fetch or a file-provider read has settled.
  const flightKey = Symbol.for('library-upload-diag-flight');
  let files = [];
  let rows = [];
  let secrets = [];
  let running = false;
  let closed = false;
  let activeController = null;
  let baseOrigin = '';
  let runtime = null;

  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  const panel = element('section');
  panel.id = panelId;
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '자료실 업로드 진단');
  panel.style.cssText = 'position:fixed;inset:8px;z-index:2147483647;background:#fff;color:#111;border:2px solid #444;padding:12px;overflow:auto;font:14px/1.5 sans-serif;box-shadow:0 4px 20px #555;';
  element('h2', '자료실 업로드 진단', panel);
  const controls = element('div', undefined, panel);
  const choose = element('button', '파일 고르기', controls);
  const start = element('button', '진단 시작', controls);
  const copy = element('button', '결과 복사', controls);
  const close = element('button', '닫기', controls);
  for (const button of [choose, start, copy, close]) {
    button.type = 'button';
    button.style.cssText = 'min-height:44px;margin:4px;padding:8px;';
  }
  start.disabled = true;
  const input = element('input', undefined, panel);
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  const note = element('p', '파일을 고른 뒤 진단 시작을 누르세요. 파일별 T0~T7 순차 실행, 각 60초, 재시도 없음.', panel);
  note.setAttribute('aria-live', 'polite');
  const table = element('table', undefined, panel);
  table.style.cssText = 'border-collapse:collapse;width:100%;font-size:12px;';
  const columns = ['파일/시험', '시작 UTC', '시간 ms', '응답 도착', 'HTTP', 'code', '오류 name/message/cause', '상세'];
  const heading = element('tr', undefined, element('thead', undefined, table));
  for (const column of columns) element('th', column, heading);
  const tbody = element('tbody', undefined, table);
  const fallback = element('textarea', undefined, panel);
  fallback.hidden = true;
  fallback.readOnly = true;
  fallback.setAttribute('aria-label', '복사할 진단 결과');
  fallback.style.cssText = 'width:100%;height:200px;';
  document.body.append(panel);
  panel.focus();
  if (window[flightKey]) {
    choose.disabled = true;
    note.textContent = '이전 진단 작업이 아직 끝나지 않았습니다. 완료 후 북마크를 다시 열거나 페이지를 새로고침하세요.';
  }

  // All output from errors, JSON code and file metadata passes this boundary.
  // Exact values plus common credential formats are masked, never logged.
  function safeText(value) {
    let text = String(value ?? '');
    for (const secret of secrets) text = text.split(secret).join('[가림]');
    return text.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [가림]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[가림]')
      .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '[가림]');
  }
  function rememberSecrets(session) {
    const values = [runtime?.config?.key];
    for (const [name, value] of Object.entries(session || {})) {
      if (/token/i.test(name)) values.push(value);
    }
    for (const value of values) {
      if (typeof value === 'string' && value && !secrets.includes(value)) secrets.push(value);
    }
  }
  function errorText(error) {
    const cause = error?.cause;
    return safeText(JSON.stringify({
      name: String(error?.name || 'Error'),
      message: String(error?.message || error || ''),
      cause: cause ? {
        name: String(cause.name || ''),
        message: String(cause.message || ''),
        code: String(cause.code || '')
      } : null
    }));
  }
  function render(row) {
    const tr = element('tr', undefined, tbody);
    for (const value of [row.test, row.utc, row.ms, row.arrived, row.status, row.code, row.error, row.detail]) {
      const td = element('td', safeText(value), tr);
      td.style.cssText = 'border:1px solid #aaa;padding:4px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap;';
    }
  }
  function cancellation(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
  }
  async function trial(index, label, operation) {
    const row = {
      test: '파일 ' + index + ' / ' + label,
      utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ms: '', arrived: '아니오', status: '', code: '', error: '', detail: ''
    };
    const began = performance.now();
    const controller = new AbortController();
    activeController = controller;
    let timer;
    const flight = {};
    window[flightKey] = flight;
    const work = Promise.resolve().then(() => operation(row, controller));
    const settled = () => {
      if (window[flightKey] === flight) window[flightKey] = null;
      if (!running && !closed) choose.disabled = false;
    };
    // Handle either outcome without creating an unhandled rejection.
    work.then(settled, settled);
    const interrupted = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      timer = setTimeout(() => controller.abort(cancellation('TimeoutError', '60초 제한 초과. 이후 시험 중단.')), limitMs);
    });
    try {
      await Promise.race([work, interrupted]);
    } catch (error) {
      row.error = errorText(error);
    } finally {
      clearTimeout(timer);
      row.ms = String(Math.round(performance.now() - began));
      // Late completions cannot change the saved/displayed result.
      const saved = Object.fromEntries(Object.entries(row).map(([name, value]) => [name, safeText(value)]));
      rows.push(saved);
      if (!closed) render(saved);
      activeController = null;
    }
    return !controller.signal.aborted;
  }
  function checkActive(controller) {
    if (closed || controller.signal.aborted) throw controller.signal.reason || cancellation('AbortError', '닫기로 중단');
  }
  function sameSizeBlob(size) {
    let blob = new Blob([new Uint8Array(Math.min(size, 65536))], { type: 'application/pdf' });
    while (blob.size < size) {
      const remaining = size - blob.size;
      blob = new Blob([blob, blob.slice(0, Math.min(blob.size, remaining))], { type: 'application/pdf' });
    }
    return blob;
  }
  function environment() {
    runtime = window.KPTURuntime;
    const session = runtime?.session?.read?.();
    rememberSecrets(session);
    const config = runtime?.config;
    if (!config?.url || !config?.key) throw new Error('앱 런타임 설정을 찾을 수 없습니다.');
    const url = new URL(config.url);
    // Accept HTTPS runtime origins; HTTP is only for a loopback mock server.
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('앱 런타임 주소가 유효한 기본 origin이 아닙니다.');
    }
    baseOrigin = url.origin;
    if (typeof window.crypto?.randomUUID !== 'function') throw new Error('무작위 UUID를 만들 수 없어 요청하지 않습니다.');
    return session;
  }
  async function request(endpoint, file, name, row, controller) {
    checkActive(controller);
    if (!Object.hasOwn(paths, endpoint)) throw new Error('허용되지 않은 진단 경로');
    const session = runtime.session.read();
    rememberSecrets(session);
    if (!session?.access_token) throw new Error('로그인 세션이 없어 요청하지 않습니다.');
    const headers = { apikey: runtime.config.key, Authorization: 'Bearer ' + session.access_token };
    const body = new FormData();
    if (file) {
      // T4/T7 must retain the selected File, exactly like the app's append.
      if (name === undefined) body.append('file', file);
      else body.append('file', file, name);
    }
    const idField = endpoint === 'library' ? 'project_id' : 'meeting_id';
    body.append(idField, window.crypto.randomUUID());
    row.detail += '\n' + idField + '=' + body.get(idField);
    if (row.test.endsWith('T4')) row.detail += '\n헤더 이름: ' + Object.keys(headers).join(', ');
    const url = baseOrigin + paths[endpoint];
    // Same app window.fetch + FormData; signal bounds this diagnostic only.
    // Refuse redirects so credentials/body cannot travel to another address.
    const response = await window.fetch(url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' });
    checkActive(controller);
    row.arrived = '예';
    row.status = String(response.status);
    const text = await response.text();
    checkActive(controller);
    try {
      const data = JSON.parse(text);
      if (data && Object.hasOwn(data, 'code')) row.code = safeText(data.code);
    } catch { /* Keep HTTP evidence when the response is not JSON. */ }
  }
  choose.addEventListener('click', () => { if (!window[flightKey]) input.click(); });
  input.addEventListener('change', () => {
    if (running) return;
    files = Array.from(input.files || []);
    rows = [];
    tbody.replaceChildren();
    fallback.hidden = true;
    start.disabled = !files.length || Boolean(window[flightKey]);
    note.textContent = files.length + '개 선택. 이름은 표시하지 않고 길이만 기록합니다.';
  });
  start.addEventListener('click', async () => {
    if (running || !files.length || closed || window[flightKey]) return;
    running = true;
    choose.disabled = true;
    start.disabled = true;
    try {
      for (const [offset, file] of files.entries()) {
        const index = offset + 1;
        let setupOK = false;
        let copyFile = null;
        let copyError = '';
        note.textContent = '파일 ' + index + ' 진단 중';
        const active = await trial(index, 'T0', async (row, controller) => {
          const session = environment();
          const fetchSource = Function.prototype.toString.call(window.fetch);
          const appWrapper = fetchSource.includes('rawFetch') && fetchSource.includes('/auth/v1/user');
          row.arrived = '해당 없음';
          row.detail = '로그인 세션: ' + (session?.access_token ? '예' : '아니오') +
            '\n앱 fetch 래퍼: ' + (appWrapper ? '예' : '아니오') +
            '\n이름 길이=' + file.name.length + ', 크기=' + file.size +
            ', type=' + safeText(file.type) + ', lastModified=' + file.lastModified;
          try {
            await file.slice(0, 1).arrayBuffer();
            checkActive(controller);
            row.detail += '\n첫 1바이트 읽기: 성공';
          } catch (error) {
            checkActive(controller);
            row.detail += '\n첫 1바이트 읽기: 실패 ' + errorText(error);
          }
          setupOK = true;
        });
        if (!active || !setupOK) break;
        const tests = [
          ['T1', async (row, controller) => {
            row.detail = '기대: 400 file_missing';
            await request('library', null, undefined, row, controller);
          }],
          ['T2', async (row, controller) => {
            row.detail = '기대: 404 project_not_found';
            await request('library', new Blob([new Uint8Array(10)], { type: 'application/pdf' }), 'diag.pdf', row, controller);
          }],
          ['T3', async (row, controller) => {
            row.detail = '기대: 404 (0바이트는 400, 100MB 초과는 413)';
            await request('library', sameSizeBlob(file.size), 'diag.pdf', row, controller);
          }],
          ['T4', async (row, controller) => {
            row.detail = '기대: 404 project_not_found';
            await request('library', file, undefined, row, controller);
          }],
          ['T5', async (row, controller) => {
            row.detail = '기대: 404 project_not_found';
            try {
              const buffer = await file.arrayBuffer();
              checkActive(controller);
              copyFile = new File([buffer], file.name, { type: file.type, lastModified: file.lastModified });
            } catch (error) {
              copyError = errorText(error);
              throw error;
            }
            await request('library', copyFile, undefined, row, controller);
          }],
          ['T6', async (row, controller) => {
            row.detail = '기대: 404 project_not_found';
            if (!copyFile) {
              row.arrived = '미실행';
              row.detail = 'T5 사본 읽기 실패로 미실행: ' + copyError;
              return;
            }
            await request('library', copyFile, 'diag.pdf', row, controller);
          }],
          ['T7', async (row, controller) => {
            row.detail = '기대: 403';
            await request('meeting', file, undefined, row, controller);
          }]
        ];
        let proceed = true;
        for (const [label, operation] of tests) {
          if (closed) { proceed = false; break; }
          note.textContent = '파일 ' + index + ' / ' + label + ' 진단 중';
          if (!(await trial(index, label, operation))) { proceed = false; break; }
        }
        copyFile = null;
        if (!proceed) break;
      }
      if (!closed) note.textContent = window[flightKey]
        ? '제한 초과. 이전 작업이 아직 끝나지 않아 재실행은 잠겨 있습니다. 페이지 새로고침 후 다시 선택하세요.'
        : '진단 종료. 제한 초과·환경 오류면 이후 시험은 실행하지 않았습니다. 응답 도착은 브라우저 관측이며 Invocations와 대조하세요.';
    } catch (error) {
      if (!closed) note.textContent = errorText(error);
    } finally {
      running = false;
      if (!closed) choose.disabled = Boolean(window[flightKey]);
    }
  });
  copy.addEventListener('click', async () => {
    const text = safeText(columns.join('\t') + '\n' + rows.map(row =>
      [row.test, row.utc, row.ms, row.arrived, row.status, row.code, row.error, row.detail]
        .map(value => safeText(value).replace(/\n/g, ' / ')).join('\t')).join('\n'));
    try {
      await navigator.clipboard.writeText(text);
      if (!closed) note.textContent = '결과를 복사했습니다.';
    } catch {
      if (closed) return;
      fallback.value = text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      note.textContent = '클립보드 사용 실패. 아래 결과를 선택하여 복사하세요.';
    }
  });
  close.addEventListener('click', () => {
    closed = true;
    activeController?.abort(cancellation('AbortError', '닫기로 중단'));
    files = [];
    panel.remove();
  });
})();
