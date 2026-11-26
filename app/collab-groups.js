// COLLAB-묶인사람끼리공유 1단계 '묶기' 화면(설계 docs/design/collab-sharing.md 3절, 시안 docs/design/mockups/collab-groups-3.html, 결정 ①~⑭ 확정).
// 자리: 내 프로필 › '내 묶음' 칸. 이 칸(#psCollabPanel)을 그리는 곳은 이 파일 하나다(render 하나, 상태는 아래 state 하나).
// 서버는 app_collab_* 함수(SECURITY DEFINER, authenticated만)만 부른다. 표를 직접 읽지 않고, workspace·user id를 보내지 않는다.
// 관리자만 되는 일(초대 링크·요청 수락·내보내기·넘기기)은 서버가 다시 판정한다 — 여기서 버튼을 숨기는 것은 보기 편하게 하는 것뿐이다.
// 초대 링크 글자는 만든 화면 메모리에만 둔다(다시 볼 수 없음). 받은 링크(?join=)는 읽자마자 주소에서 지운다. 기기 저장 없음.
// 1단계 알림은 앱 안 표시(관리자 칸의 '요청 n')뿐이고 폰 알림은 6단계에서 한다.
import {askConfirm} from './small-notice.js';
import {waitHtml, waitInlineHtml, failHtml} from './wait-state.js';
import {
  KIND_NAME, CREATED_TEXT, LIMIT_HINT, EMPTY_TEXT, INVITE_HINT, LINK_NOTE, CONSENT_LINES,
  errorText, errorCode, groupName, roleText, memberLine, groupMeta, createDefaults, createReady, createArgs,
  inviteUrl, tokenFromUrl, urlWithoutToken, inviteSummary,
} from './collab-groups-model.mjs';
import {word} from './brand/brand.mjs';
import {UNION_LABEL} from './profile-words.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function mountCollabGroups(host, {rt, toast = () => {}, profile = () => ({}), appRoot = window.KPTUAuth?.APP_ROOT || location.href, win = window} = {}) {
  const state = {groups: null, failed: false, busy: false, form: null, created: '', link: null, join: null, open: new Set()};
  const rpc = (name, body = {}) => rt.api(`/rest/v1/rpc/${name}`, {method: 'POST', body, singleFlight: false});

  function consentHtml() {
    return `<div class="cg-consent"><div class="cg-consent-head">묶음 사람에게 보이는 것</div>${CONSENT_LINES.map(l => `<div>· ${esc(l)}</div>`).join('')}</div>`;
  }
  function joinHtml() {
    const j = state.join;
    if (!j) return '';
    if (j.error) return `<div class="cg-card cg-join" role="status"><div>${esc(j.error)}</div><div class="cg-acts"><button class="secondary" type="button" data-cg="join-close">닫기</button></div></div>`;
    if (!j.peek) return `<div class="cg-card cg-join">초대 링크 ${waitInlineHtml()}</div>`;
    if (j.peek.already_member) return `<div class="cg-card cg-join" role="status"><div>이미 <b>${esc(groupName(j.peek))}</b> 멤버예요.</div><div class="cg-acts"><button class="secondary" type="button" data-cg="join-close">닫기</button></div></div>`;
    const noName = !profile().name;
    return `<div class="cg-card cg-join"><div class="cg-join-title">묶음에 초대받았어요</div><div class="cg-join-who">${esc(inviteSummary(j.peek))}</div>${consentHtml()}${noName ? '<div class="cg-hint">프로필에 이름·직책을 먼저 채우고 저장한 뒤 들어갈 수 있어요.</div>' : ''}<div class="cg-acts"><button class="secondary" type="button" data-cg="join-close">안 들어가기</button><button class="primary" type="button" data-cg="join-accept"${noName || state.busy ? ' disabled' : ''}>들어가기</button></div></div>`;
  }
  function formHtml() {
    const f = state.form;
    if (!f) return '';
    const noName = !profile().name;
    return word`<form class="cg-card cg-form" data-cg-form><div class="cg-form-title">${esc(KIND_NAME[f.kind])} 만들기</div>
      <label class="cg-field"><span>${UNION_LABEL}</span><input type="text" maxlength="60" autocomplete="off" data-cg-in="union" value="${esc(f.union)}" placeholder="${UNION_LABEL}"></label>
      ${f.kind === 'dept' ? `<label class="cg-field"><span>부서명</span><input type="text" maxlength="60" autocomplete="off" data-cg-in="dept" value="${esc(f.dept)}" placeholder="부서명"></label>` : ''}
      ${consentHtml()}${noName ? '<div class="cg-hint">프로필에 이름·직책을 먼저 채우고 저장한 뒤 만들 수 있어요.</div>' : ''}
      <div class="cg-acts"><button class="secondary" type="button" data-cg="form-cancel">취소</button><button class="primary" type="submit" data-cg="form-ok"${createReady(f) && !noName && !state.busy ? '' : ' disabled'}>만들기</button></div>
      <div class="cg-muted">${esc(LIMIT_HINT)}</div></form>`;
  }
  function linkHtml(g) {
    if (state.link?.groupId !== g.id) return '';
    const canShare = typeof win.navigator?.share === 'function';
    return `<div class="cg-link-box"><div class="cg-sec">초대 링크</div><div class="cg-link" data-cg-link>${esc(state.link.url)}</div><div class="cg-acts"><button class="secondary" type="button" data-cg="link-copy">복사</button>${canShare ? '<button class="secondary" type="button" data-cg="link-share">공유</button>' : ''}<button class="ghost" type="button" data-cg="link-close">닫기</button></div><div class="cg-muted">${esc(LINK_NOTE)}</div></div>`;
  }
  function groupHtml(g) {
    const admin = g.my_role === 'admin', requests = admin ? g.requests || [] : [], members = g.members || [];
    const reqRows = requests.map(r => word`<div class="cg-ln"><span class="cg-nm">${esc(memberLine(r))}</span><span class="cg-t">같은 ${UNION_LABEL}·부서명으로 요청</span><button class="secondary" type="button" data-cg="req-yes" data-id="${esc(r.id)}">수락</button><button class="ghost" type="button" data-cg="req-no" data-id="${esc(r.id)}">거절</button></div>`).join('');
    const memRows = members.map(m => {
      const menu = admin && !m.me ? `<details class="cg-more"><summary data-ctx="off" aria-label="${esc(memberLine(m))} 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="cg-more-menu"><button type="button" class="ghost" data-cg="admin-move" data-id="${esc(m.id)}">관리자 넘기기</button><button type="button" class="ghost" data-cg="remove" data-id="${esc(m.id)}">내보내기</button></div></details>` : '';
      return `<div class="cg-ln"><span class="cg-nm">${esc(m.name)}</span><span class="cg-t">${esc(m.title || '')}</span>${m.role === 'admin' ? `<span class="cg-tag">${roleText('admin')}</span>` : ''}${menu}</div>`;
    }).join('');
    const live = admin && g.invites_live ? `<div class="cg-ln cg-live"><span class="cg-t">살아 있는 링크 ${Number(g.invites_live)}개</span><button class="ghost" type="button" data-cg="links-off" data-id="${esc(g.id)}">링크 모두 끄기</button></div>` : '';
    return `<details class="cg-group" data-cg-group="${esc(g.id)}"${state.open.has(g.id) ? ' open' : ''}><summary><span class="cg-gname">${esc(groupName(g))}</span><span class="cg-gmeta">${esc(groupMeta(g))}</span></summary><div class="cg-body">
      ${requests.length ? `<div class="cg-sec">들어오기 요청 <span class="cg-n">${requests.length}</span></div>${reqRows}` : ''}
      <div class="cg-sec">멤버 <span class="cg-n">${members.length}</span>${admin ? `<button class="secondary cg-sec-btn" type="button" data-cg="invite" data-id="${esc(g.id)}">초대 링크 만들기</button>` : ''}</div>${memRows}${live}${linkHtml(g)}
      <div class="cg-acts cg-foot"><button class="ghost" type="button" data-cg="leave" data-id="${esc(g.id)}">묶음 나가기</button></div></div></details>`;
  }
  function render() {
    const gs = state.groups;
    const head = `<h3>내 묶음 <span class="cg-n">${gs ? gs.length : ''}</span></h3>`;
    let body;
    if (state.failed) body = failHtml({retry: 'data-cg-retry', text: '내 묶음을 불러오지 못했어요.'});
    else if (!gs) body = waitHtml({rows: 2});
    else body = `${state.created ? `<div class="cg-card cg-done" role="status">${esc(state.created)}</div>` : ''}${gs.length ? gs.map(groupHtml).join('') : `<div class="cg-muted">${esc(EMPTY_TEXT)}</div>`}
      ${formHtml()}${state.form ? '' : `<div class="cg-acts"><button class="secondary" type="button" data-cg="new" data-kind="dept">+ ${KIND_NAME.dept} 만들기</button><button class="secondary" type="button" data-cg="new" data-kind="union">+ ${KIND_NAME.union} 만들기</button></div>`}
      ${gs.length ? '' : `<div class="cg-muted">${esc(INVITE_HINT)}</div>`}`;
    host.innerHTML = head + joinHtml() + body;
  }

  async function load() {
    try { state.groups = await rpc('app_collab_my_groups'); state.failed = false; }
    catch (e) { if (!state.groups) state.failed = true; else toast(errorText(e)); }
    render();
  }
  async function act(fn, {reload = true} = {}) {
    if (state.busy) return;
    state.busy = true;
    try { await fn(); } catch (e) { toast(errorText(e)); }
    finally { state.busy = false; }
    if (reload) await load(); else render();
  }
  const byId = id => (state.groups || []).find(g => g.id === id);
  const memberById = id => { for (const g of state.groups || []) { const m = (g.members || []).find(x => x.id === id); if (m) return {g, m}; } return null; };

  async function startJoin() {
    const token = tokenFromUrl(win.location.href);
    if (!token) return;
    // 받은 링크는 읽자마자 주소에서 지운다(뒤로가기·새로고침·화면 캡처에 남지 않게).
    try { win.history.replaceState(win.history.state, '', urlWithoutToken(win.location.href)); } catch { /* 주소 못 바꿈 */ }
    if (token === 'bad') { state.join = {error: errorText('COLLAB_INVITE_UNUSABLE')}; render(); return; }
    state.join = {token, peek: null};
    render();
    try { state.join.peek = await rpc('app_collab_invite_peek', {p_token: token}); }
    catch (e) { state.join = {error: errorText(e)}; }
    render();
    host.scrollIntoView?.({block: 'start'});
  }

  host.addEventListener('toggle', e => {
    const d = e.target.closest?.('[data-cg-group]');
    if (!d || e.target !== d) return;
    if (d.open) state.open.add(d.dataset.cgGroup); else state.open.delete(d.dataset.cgGroup);
  }, true);
  host.addEventListener('input', e => {
    const key = e.target.dataset?.cgIn;
    if (!key || !state.form) return;
    state.form[key] = e.target.value;
    const ok = host.querySelector('[data-cg="form-ok"]');
    if (ok) ok.disabled = !createReady(state.form) || !profile().name || state.busy;
  });
  host.addEventListener('submit', e => {
    if (!e.target.matches('[data-cg-form]')) return;
    e.preventDefault();
    const f = state.form;
    if (!f || !createReady(f) || !profile().name) return;
    act(async () => {
      await rpc('app_collab_group_create', createArgs(f));
      state.created = CREATED_TEXT[f.kind];
      state.form = null;
    });
  });
  host.addEventListener('click', async e => {
    if (e.target.closest?.('[data-cg-retry]')) { state.failed = false; render(); return load(); }
    const b = e.target.closest?.('[data-cg]');
    if (!b || b.disabled) return;
    const what = b.dataset.cg, id = b.dataset.id;
    if (what === 'new') { state.form = createDefaults(b.dataset.kind); state.created = ''; render(); host.querySelector('[data-cg-in="union"]')?.focus(); return; }
    if (what === 'form-cancel') { state.form = null; render(); return; }
    if (what === 'join-close') { state.join = null; render(); return; }
    if (what === 'join-accept') {
      const token = state.join?.token;
      if (!token) return;
      return act(async () => {
        try {
          const gid = await rpc('app_collab_invite_accept', {p_token: token, p_agree: true});
          state.join = null; if (gid) state.open.add(gid);
          toast('묶음에 들어갔어요.');
        } catch (err) {
          if (errorCode(err) === 'COLLAB_INVITE_UNUSABLE') state.join = {error: errorText(err)};
          throw err;
        }
      });
    }
    if (what === 'invite') {
      return act(async () => {
        const made = await rpc('app_collab_invite_create', {p_group: id});
        state.link = {groupId: id, url: inviteUrl(appRoot, made?.token)};
        state.open.add(id);
      });
    }
    if (what === 'link-close') { state.link = null; render(); return; }
    if (what === 'link-copy') {
      try { await win.navigator.clipboard.writeText(state.link?.url || ''); toast('링크를 복사했어요.'); }
      catch { toast('복사하지 못했어요. 링크 글자를 길게 눌러 복사해 주세요.'); }
      return;
    }
    if (what === 'link-share') { try { await win.navigator.share({url: state.link?.url || ''}); } catch { /* 공유 창 닫음 */ } return; }
    if (what === 'links-off') {
      if (!(await askConfirm(b, {text: '살아 있는 초대 링크를 모두 끌까요?', note: '이미 들어온 멤버는 그대로예요.', ok: '모두 끄기', danger: true}))) return;
      return act(async () => { await rpc('app_collab_invite_revoke_all', {p_group: id}); if (state.link?.groupId === id) state.link = null; });
    }
    if (what === 'req-yes' || what === 'req-no') {
      return act(async () => {
        const r = await rpc('app_collab_request_decide', {p_request: id, p_accept: what === 'req-yes'});
        toast(r === 'accepted' ? '수락했어요.' : r === 'declined' ? '거절했어요.' : '이미 정리된 요청이에요.');
      });
    }
    if (what === 'leave') {
      const g = byId(id);
      if (!g) return;
      const last = (g.members || []).length <= 1;
      if (!(await askConfirm(b, {text: `${groupName(g)}에서 나갈까요?`, note: last ? '마지막 멤버라 묶음이 삭제돼요.' : '나가면 이 묶음에 나눈 것을 볼 수 없어요. 내 기록은 내 공간에 그대로 있어요.', ok: '나가기', danger: true}))) return;
      return act(async () => { await rpc('app_collab_leave', {p_group: id}); state.open.delete(id); if (state.link?.groupId === id) state.link = null; });
    }
    if (what === 'remove' || what === 'admin-move') {
      const hit = memberById(id);
      if (!hit) return;
      const move = what === 'admin-move';
      const text = move ? `${memberLine(hit.m)}에게 관리자를 넘길까요?` : `${memberLine(hit.m)}을(를) ${groupName(hit.g)}에서 내보낼까요?`;
      if (!(await askConfirm(b, {text, note: move ? '넘기면 나는 멤버가 돼요.' : '', ok: move ? '넘기기' : '내보내기', danger: !move}))) return;
      return act(async () => { await rpc(move ? 'app_collab_admin_move' : 'app_collab_member_remove', {p_member: id}); });
    }
  });

  render();
  return {
    async load() { await load(); await startJoin(); },
    refresh: () => render(),
  };
}
