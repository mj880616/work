// S67-48 노트 태그 칸: 노트 읽기·고치기 화면의 #태그 칩 줄(칩 × = 빼기) + [+ 태그] → 바로 아래 펼치는 고르기 칸
// (지금까지 쓴 태그 많이 쓴 순·찾기·새 태그). 여러 개를 이어서 고를 수 있고 [닫기]·Esc로 접는다.
// 이 파일은 그리기와 고르기만 한다. 태그 원본은 노트 본문의 #태그 하나(note-tags.mjs), 저장은 basket-notes.js의 노트 저장 길(서버) 하나다.
import {cleanTagInput, tagKey, TAG_INPUT_HELP} from './note-tags.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const SHOW_MAX = 30;

// 칩 줄 글(span 안에 넣는다). link: 칩 이름을 누르면 [태그] 보기로 가는 단추(data-note-tag), 아니면 글자만.
export function tagChipsHtml(tags, {link = true, removable = true, addOpen = false} = {}) {
  const chips = tags.map(tag => {
    const key = tagKey(tag), name = `#${esc(tag)}`;
    const label = link ? `<button type="button" class="row-act note-meta-tag" data-note-tag="${esc(key)}">${name}</button>` : `<span class="note-meta-tag">${name}</span>`;
    const x = removable ? `<button type="button" class="row-act ntf-x" data-tag-remove="${esc(key)}" aria-label="${name} 빼기" title="빼기">×</button>` : '';
    return `<span class="ntf-chip" data-tag-chip="${esc(key)}">${label}${x}</span>`;
  }).join('');
  const add = removable ? `<button type="button" class="row-act ntf-add" data-tag-add aria-expanded="${addOpen}">+ 태그</button>` : '';
  return `<span class="a11y-only">태그: </span>${chips}${add}`;
}

// 고르기 칸. box: 비어 있는 div(이 칸이 그린다). all(): [{tag,key,count}] 많이 쓴 순, have(): 이 노트 태그 key들,
// onAdd(tag) → Promise<{ok, message?}>. onToggle(open): 칸이 열리고 닫힐 때(단추 aria-expanded 맞추기). findTrigger(): 닫을 때 돌아갈 [+ 태그].
export function createTagPick(box, {all, have, onAdd, onToggle = () => {}, findTrigger = () => null}) {
  let open = false, query = '', msg = '';
  box.classList.add('ntf-panel');
  box.hidden = true;
  box.innerHTML = `<div class="ntf-panel-head"><label class="ntf-find"><span class="a11y-only">태그 찾기 또는 새 태그</span><input type="search" data-tag-find placeholder="태그 찾기·새 태그" autocomplete="off" enterkeyhint="done" maxlength="41"></label><button type="button" class="row-act ntf-close" data-tag-pick-close>닫기</button></div><div class="ntf-list" data-tag-list role="group" aria-label="태그 선택"></div><p class="ntf-msg" data-tag-msg role="status"></p>`;
  const input = box.querySelector('[data-tag-find]'), listBox = box.querySelector('[data-tag-list]'), msgBox = box.querySelector('[data-tag-msg]');
  function paint() {
    const mine = new Set(have()), q = tagKey(query.trim().replace(/^#+/, ''));
    const rows = all().filter(g => !mine.has(g.key) && (!q || g.key.includes(q)));
    const typed = cleanTagInput(query), exact = typed && (all().some(g => g.key === tagKey(typed)));
    const fresh = typed && !exact && !mine.has(tagKey(typed)) ? `<button type="button" class="ds-chip ntf-item ntf-new" data-tag-new="${esc(typed)}">새 태그 #${esc(typed)} 추가</button>` : '';
    listBox.innerHTML = fresh + rows.slice(0, SHOW_MAX).map(g => `<button type="button" class="ds-chip ntf-item" data-tag-pick-item="${esc(g.tag)}">#${esc(g.tag)}<span class="nt-num" aria-label="노트 ${g.count}개">${g.count}</span></button>`).join('')
      + (!fresh && !rows.length ? `<span class="ntf-none">${query.trim() ? (typed && mine.has(tagKey(typed)) ? '이미 붙은 태그예요' : esc(TAG_INPUT_HELP)) : '태그 이름을 써 주세요'}</span>` : '');
    msgBox.textContent = msg;
  }
  async function pick(tag) {
    msg = '';
    const result = await onAdd(tag);
    if (!open) return;
    if (result && !result.ok) msg = result.message || '태그를 붙이지 못했어요.';
    else { query = ''; input.value = ''; }
    paint();
    if (input.isConnected) input.focus({preventScroll: true});
  }
  box.addEventListener('input', e => { if (e.target === input) { query = input.value; msg = ''; paint(); } });
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close({focus: true}); return; }
    if (e.key === 'Enter' && e.target === input && !e.isComposing) {
      e.preventDefault();
      const typed = cleanTagInput(query);
      if (typed) void pick(typed); else { msg = query.trim() ? TAG_INPUT_HELP : ''; paint(); }
    }
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
    e.stopPropagation();
    if (b.hasAttribute('data-tag-pick-close')) close({focus: true});
    else if (b.hasAttribute('data-tag-new')) void pick(b.dataset.tagNew);
    else if (b.hasAttribute('data-tag-pick-item')) void pick(b.dataset.tagPickItem);
  });
  function show() {
    open = true; query = ''; msg = ''; input.value = ''; box.hidden = false; paint(); onToggle(true);
    input.focus({preventScroll: true});
  }
  function close({focus = false} = {}) {
    if (!open) return;
    open = false; box.hidden = true; onToggle(false);
    if (focus) findTrigger()?.focus({preventScroll: true});
  }
  return {
    toggle() { if (open) close({focus: false}); else show(); },
    close, refresh: () => { if (open) paint(); },
    isOpen: () => open,
  };
}
