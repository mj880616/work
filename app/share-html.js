// SHARE-보관함·HTML공유 (docs/design/share-html-pages.md 7절): the HTML file share page window, opened from the 공유 페이지 list
// (share-pages.js owns the list; this module owns only the window #shareHtmlModal and the requests it sends).
// [+ HTML]: file (drop or pick) → preview → title · link name · 기한 → [저장하고 링크 켜기].
// [새 파일로 바꾸기]: file → preview → [바꾸기] (a new version; the same link, the old version stays in the DB).
// A row press: preview only. Everything is stored on the server (owner-RLS tables); nothing is kept in this browser.
// The file is shown only in a sandboxed frame without allow-same-origin (HTML_SANDBOX): it cannot read this app's sign-in.
// The short link (name + 8 letters the DB makes) is read from the DB when needed and is not kept in this module.
import {HTML_SANDBOX, SHORT_BASE, CODE_LENGTH, fileProblem, textProblem, htmlTitle, nameFrom, nameProblem, shortUrl, expiryOf}
  from './share-html-model.mjs';
import {copyText} from './copy-text.js';
import {waitEl} from './wait-state.js';

const q = encodeURIComponent;
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return node;
}
const message = (e, fallback) => (e?.status === 401 || e?.code === 'session_required') ? '로그인이 끝났어요. 다시 로그인해 주세요.' : fallback;

// A sandboxed frame showing this HTML. srcdoc: this app has no CSP, so the file's own and CDN scripts (graphs, tables) run inside.
export function htmlFrame(html, title) {
  const frame = el('iframe', {class:'sh-frame', title:`${title || 'HTML 파일'} 미리 보기`, sandbox:HTML_SANDBOX, referrerpolicy:'no-referrer',
    loading:'eager', dataset:{shFrame:''}});
  frame.srcdoc = html;
  return frame;
}

export function createShareHtml({rt, workspaceId, onChanged}) {
  let modal = null, state = null, trigger = null;

  function ensureModal() {
    if (modal) return modal;
    modal = el('div', {id:'shareHtmlModal', class:'modal sh-modal hidden', role:'dialog', 'aria-modal':'true', 'aria-hidden':'true', 'aria-labelledby':'shareHtmlTitle'},
      el('div', {class:'modal-card sh-card'},
        el('div', {class:'sh-head'}, el('h2', {id:'shareHtmlTitle', text:'HTML 공유 페이지'}),
          el('button', {type:'button', class:'mini', dataset:{shClose:''}, 'aria-label':'HTML 창 닫기', text:'닫기'})),
        el('div', {class:'sh-body', dataset:{shBody:''}})));
    modal.addEventListener('click', onClick);
    modal.addEventListener('change', onChange);
    modal.addEventListener('input', onInput);
    modal.addEventListener('dragover', event => { if (event.target.closest?.('[data-sh-drop]')) { event.preventDefault(); event.target.closest('[data-sh-drop]').classList.add('is-over'); } });
    modal.addEventListener('dragleave', event => event.target.closest?.('[data-sh-drop]')?.classList.remove('is-over'));
    modal.addEventListener('drop', event => {
      const zone = event.target.closest?.('[data-sh-drop]');
      if (!zone) return;
      event.preventDefault(); zone.classList.remove('is-over');
      void takeFile(event.dataTransfer?.files?.[0]);
    });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    (document.querySelector('#pagesView') || document.body).append(modal);
    return modal;
  }
  const body = () => modal.querySelector('[data-sh-body]');
  const status = text => { const node = modal?.querySelector('[data-sh-status]'); if (node) node.textContent = text; };

  function open(next) {
    ensureModal();
    state = next; trigger = document.activeElement;
    modal.querySelector('#shareHtmlTitle').textContent = next.mode === 'new' ? '새 HTML 공유 페이지' : next.mode === 'replace' ? '새 파일로 바꾸기' : (next.title || 'HTML 공유 페이지');
    render();
    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false');
    const first = modal.querySelector('[data-sh-pick]') || modal.querySelector('[data-sh-close]');
    window.KPTUA11y?.dialog?.activate?.(modal, {trigger, initialFocus:first, onRequestClose:close});
    first?.focus();
  }
  function close() {
    if (!modal || modal.classList.contains('hidden')) return;
    if (state?.busy) return;
    modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true');
    body().replaceChildren();
    state = null;
    window.KPTUA11y?.dialog?.deactivate?.(modal, {restoreFocus:true, fallbackFocus:'#pagesView h2'});
  }

  function render() {
    const s = state, nodes = [];
    if (s.mode !== 'preview') {
      nodes.push(el('div', {class:'sh-drop', dataset:{shDrop:''}},
        el('p', {class:'sh-drop-text', text:s.fileName ? `${s.fileName}` : 'HTML 파일을 여기로 끌어 놓거나'}),
        el('button', {type:'button', class:'sp-tool', dataset:{shPick:''}, text:s.fileName ? '다른 파일 고르기' : '파일 고르기'}),
        el('input', {type:'file', accept:'.html,.htm,text/html', hidden:true, dataset:{shFile:''}}),
        el('p', {class:'sp-hint', text:'5MB까지 · 그래프·표·외부 라이브러리도 그대로 보여요'})));
    }
    if (s.mode === 'new') {
      const name = el('input', {type:'text', class:'sp-input sh-name', maxLength:40, value:s.name || '', placeholder:'예: minja-rail', inputmode:'url',
        autocapitalize:'off', autocomplete:'off', spellcheck:'false', 'aria-label':'링크 이름', dataset:{shName:''}});
      name.value = s.name || '';
      const title = el('input', {type:'text', class:'sp-input', maxLength:200, placeholder:'제목(링크 미리보기에 보여요)', 'aria-label':'제목', dataset:{shTitle:''}});
      title.value = s.title || '';
      const expiry = el('select', {class:'sp-input sh-expiry', 'aria-label':'기한', dataset:{shExpiry:''}},
        el('option', {value:'none', text:'없음'}), el('option', {value:'30', text:'30일'}), el('option', {value:'90', text:'90일'}), el('option', {value:'date', text:'날짜 고르기'}));
      expiry.value = s.expiry || 'none';
      nodes.push(el('div', {class:'sh-fields'},
        el('label', {class:'sp-field'}, el('span', {text:'제목'}), title),
        el('div', {class:'sp-field'}, el('span', {id:'shNameLabel', text:'링크'}),
          el('div', {class:'sh-url', role:'group', 'aria-labelledby':'shNameLabel'},
            el('span', {class:'sh-url-base', text:SHORT_BASE.replace(/^https:\/\//, '')}), name,
            el('span', {class:'sh-url-code', title:'저장할 때 무작위 글자가 붙어요', text:'-' + '·'.repeat(CODE_LENGTH)}))),
        el('label', {class:'sp-field'}, el('span', {text:'기한'}), expiry,
          el('input', {type:'date', class:'sp-input', hidden:s.expiry !== 'date', 'aria-label':'기한 날짜', dataset:{shExpiryDay:''}}))));
    }
    if (s.html) nodes.push(el('div', {class:'sh-preview', dataset:{shPreview:''}}, htmlFrame(s.html, s.title)));
    else if (s.mode === 'preview') nodes.push(s.loading ? waitEl({rows:3}) : el('p', {class:'sp-hint', text:'파일을 불러오지 못했어요.'}));
    nodes.push(el('p', {class:'sp-status', role:'status', 'aria-live':'polite', dataset:{shStatus:''}, text:s.note || ''}));
    if (s.link) nodes.push(el('div', {class:'sh-done'}, el('code', {class:'sh-link', dataset:{shLink:''}, text:s.link}),
      el('button', {type:'button', class:'sp-tool', dataset:{shCopy:''}, text:'복사'})));
    if (s.mode === 'new' && !s.link) nodes.push(el('div', {class:'sh-actions'},
      el('button', {type:'button', class:'primary', disabled:!s.html || s.busy, dataset:{shSave:''}, text:'저장하고 링크 켜기'})));
    if (s.mode === 'replace' && !s.done) nodes.push(el('div', {class:'sh-actions'},
      el('button', {type:'button', class:'primary', disabled:!s.html || s.busy, dataset:{shReplace:''}, text:'바꾸기'})));
    body().replaceChildren(...nodes);
  }

  async function takeFile(file) {
    if (!state || state.mode === 'preview') return;
    const problem = fileProblem(file);
    if (problem) { status(problem); return; }
    let text;
    try { text = await file.text(); } catch { status('파일을 읽지 못했어요.'); return; }
    const tooBig = textProblem(text);
    if (tooBig) { status(tooBig); return; }
    state.html = text; state.fileName = String(file.name || '').slice(0, 200);
    if (state.mode === 'new') {
      const fromFile = htmlTitle(text);
      if (!state.titleTouched) state.title = fromFile || state.fileName.replace(/\.html?$/i, '');
      if (!state.nameTouched) state.name = nameFrom(state.title) || nameFrom(state.fileName.replace(/\.html?$/i, ''));
    }
    state.note = '';
    render();
  }

  function onInput(event) {
    const d = event.target.dataset || {};
    if (!state) return;
    if ('shTitle' in d) { state.title = event.target.value; state.titleTouched = true; }
    if ('shName' in d) {
      const clean = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (clean !== event.target.value) event.target.value = clean;
      state.name = clean; state.nameTouched = true;
    }
  }
  function onChange(event) {
    const d = event.target.dataset || {};
    if (!state) return;
    if ('shFile' in d) { void takeFile(event.target.files?.[0]); event.target.value = ''; }
    if ('shExpiry' in d) { state.expiry = event.target.value; const day = modal.querySelector('[data-sh-expiry-day]'); if (day) day.hidden = state.expiry !== 'date'; }
    if ('shExpiryDay' in d) state.expiryDay = event.target.value;
  }
  function onClick(event) {
    const button = event.target.closest?.('button');
    if (!button || !modal.contains(button)) return;
    const d = button.dataset;
    if ('shClose' in d) close();
    else if ('shPick' in d) modal.querySelector('[data-sh-file]')?.click();
    else if ('shSave' in d) void saveNew();
    else if ('shReplace' in d) void replace();
    else if ('shCopy' in d) void copyText(state.link).then(ok => status(ok ? '링크를 복사했어요.' : '복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.'));
  }

  const api = (path, options) => rt.api(path, {singleFlight:false, ...options});
  async function saveNew() {
    const s = state;
    if (!s || s.busy || !s.html) return;
    const title = String(s.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!title) { status('제목을 써 주세요.'); return; }
    const nameIssue = nameProblem(s.name);
    if (nameIssue) { status(nameIssue); return; }
    let expires_at;
    try { expires_at = expiryOf(s.expiry, s.expiryDay); } catch (e) { status(e.message); return; }
    s.busy = true; render(); status('저장하는 중…');
    const ws = workspaceId();
    let pageId = null;
    try {
      // Order (design 7절): page as a draft → file → link → short link → publish. A stop on the way leaves an 'HTML · 초안'
      // line whose ⋯ [링크 켜기] goes on from there; nothing is removed.
      const page = await api('/rest/v1/app_share_pages?select=id', {method:'POST', prefer:'return=representation', body:{workspace_id:ws, title:title.slice(0, 200), blocks:[], status:'draft'}});
      pageId = page?.[0]?.id;
      if (!pageId) throw new Error('page');
      await api('/rest/v1/app_share_page_html', {method:'POST', prefer:'return=minimal', body:{workspace_id:ws, page_id:pageId, html:s.html, file_name:s.fileName || ''}});
      const link = await linkOn(pageId, {name:s.name, expires_at});
      s.link = link; s.note = '링크를 켰어요. [복사]를 눌러 보내세요.';
      onChanged?.();
    } catch (e) {
      s.note = message(e, pageId ? '다 저장하지 못했어요. 목록의 ⋯ [링크 켜기]로 이어서 할 수 있어요.' : '저장하지 못했어요. 다시 시도해 주세요.');
      if (pageId) onChanged?.();
    } finally { s.busy = false; if (state === s) render(); }
  }
  // Makes (or reuses) this page's short link, turns its links on and publishes the page. Returns the short link.
  async function linkOn(pageId, {name, expires_at = null} = {}) {
    const ws = workspaceId();
    let short = await shortOf(pageId);
    if (!short) {
      if (nameProblem(name)) throw Object.assign(new Error('name'), {code:'name_needed'});
      const link = await api('/rest/v1/app_share_page_links?select=token_hash', {method:'POST', prefer:'return=representation', body:{workspace_id:ws, page_id:pageId, label:'', expires_at}});
      const hash = link?.[0]?.token_hash;
      if (!hash) throw new Error('link');
      const made = await api('/rest/v1/app_share_page_slugs?select=slug_name,slug_code', {method:'POST', prefer:'return=representation', body:{workspace_id:ws, token_hash:hash, slug_name:name}});
      short = made?.[0];
      if (!short) throw new Error('slug');
    }
    await api(`/rest/v1/app_share_page_links?page_id=eq.${q(pageId)}&workspace_id=eq.${q(ws)}&disabled_at=not.is.null`, {method:'PATCH', prefer:'return=minimal', body:{disabled_at:null}});
    await api(`/rest/v1/app_share_pages?id=eq.${q(pageId)}&workspace_id=eq.${q(ws)}`, {method:'PATCH', prefer:'return=minimal', body:{status:'published', updated_at:new Date().toISOString()}});
    return shortUrl(short.slug_name, short.slug_code);
  }
  // The short link of this page's newest link that has one (owner RLS), or null.
  async function shortOf(pageId) {
    const ws = workspaceId();
    const links = await api(`/rest/v1/app_share_page_links?page_id=eq.${q(pageId)}&workspace_id=eq.${q(ws)}&select=token_hash&order=created_at.desc`, {});
    const hashes = (Array.isArray(links) ? links : []).map(l => l.token_hash).filter(h => /^[0-9a-f]{64}$/.test(h));
    if (!hashes.length) return null;
    const rows = await api(`/rest/v1/app_share_page_slugs?workspace_id=eq.${q(ws)}&token_hash=in.(${hashes.join(',')})&select=token_hash,slug_name,slug_code`, {});
    if (!Array.isArray(rows) || !rows.length) return null;
    return hashes.map(h => rows.find(r => r.token_hash === h)).find(Boolean) || null;
  }
  async function replace() {
    const s = state;
    if (!s || s.busy || !s.html) return;
    s.busy = true; render(); status('바꾸는 중…');
    try {
      const ws = workspaceId();
      await api('/rest/v1/app_share_page_html', {method:'POST', prefer:'return=minimal', body:{workspace_id:ws, page_id:s.pageId, html:s.html, file_name:s.fileName || ''}});
      await api(`/rest/v1/app_share_pages?id=eq.${q(s.pageId)}&workspace_id=eq.${q(ws)}`, {method:'PATCH', prefer:'return=minimal', body:{updated_at:new Date().toISOString()}});
      s.done = true; s.note = '새 파일로 바꿨어요. 링크는 그대로예요.';
      onChanged?.();
    } catch (e) { s.note = message(e, '바꾸지 못했어요. 다시 시도해 주세요.'); }
    finally { s.busy = false; if (state === s) render(); }
  }
  async function latest(pageId) {
    const rows = await api(`/rest/v1/app_share_page_html?page_id=eq.${q(pageId)}&workspace_id=eq.${q(workspaceId())}&select=html&order=created_at.desc&limit=1`, {});
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].html !== 'string') throw new Error('missing');
    return rows[0].html;
  }

  return {
    openNew() { open({mode:'new', expiry:'none'}); },
    openReplace(page) { open({mode:'replace', pageId:page.id, title:page.title}); },
    async openPreview(page) {
      const s = {mode:'preview', pageId:page.id, title:page.title, loading:true};
      open(s);
      try { s.html = await latest(page.id); } catch { s.note = '파일을 불러오지 못했어요.'; }
      s.loading = false;
      if (state === s) render();
    },
    // ⋯ [링크 복사]: reads the short link now and copies it. Returns a sentence for the list.
    async copyLink(page) {
      try {
        const short = await shortOf(page.id);
        if (!short) return '이 페이지에는 아직 링크가 없어요. ⋯ [링크 켜기]를 눌러 주세요.';
        const ok = await copyText(shortUrl(short.slug_name, short.slug_code));
        return ok ? '링크를 복사했어요. 메신저에 붙여 넣어 보내세요.' : '복사하지 못했어요. 다시 눌러 주세요.';
      } catch (e) { return message(e, '링크를 복사하지 못했어요.'); }
    },
    // ⋯ [링크 끄기]: every link of this page off (long and short together; the page and file stay).
    async linkOff(page) {
      try {
        await api(`/rest/v1/app_share_page_links?page_id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}&disabled_at=is.null`, {method:'PATCH', prefer:'return=minimal', body:{disabled_at:new Date().toISOString()}});
        onChanged?.();
        return '링크를 껐어요. 이제 그 링크로는 열리지 않아요.';
      } catch (e) { return message(e, '링크를 끄지 못했어요. 다시 시도해 주세요.'); }
    },
    // ⋯ [링크 켜기]: the same short link again (or a new one when the save stopped before it; the name is asked once).
    async linkOn(page) {
      try {
        let link;
        try { link = await linkOn(page.id); }
        catch (e) {
          if (e?.code !== 'name_needed') throw e;
          const name = window.prompt('링크 이름(영어 소문자·숫자·하이픈)', nameFrom(page.title) || '');
          if (name === null) return '';
          const issue = nameProblem(name.trim());
          if (issue) return issue;
          link = await linkOn(page.id, {name:name.trim()});
        }
        onChanged?.();
        const ok = await copyText(link);
        return ok ? '링크를 켜고 복사했어요.' : '링크를 켰어요. ⋯ [링크 복사]로 복사해 주세요.';
      } catch (e) { return message(e, '링크를 켜지 못했어요. 다시 시도해 주세요.'); }
    },
    close,
    isOpen: () => !!modal && !modal.classList.contains('hidden'),
  };
}
