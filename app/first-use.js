// HELP-처음쓰는사람안내(시안 docs/design/mockups/help-first-use.html ①②③, 사용자 확정 11/16): 조직 관리·사업 관리·브리핑 룸이 비어 있을 때
// 그 목록 자리에 '무엇을 하는 곳인지 + 따라하기 3단계 + [할 일 버튼] [쓰는 법 보기]'를 그린다. 기록이 하나라도 생기면 그 화면이 이 대신
// 기록을 그린다(숨김이 아니라 그리는 조건 — 판단은 각 화면이 서버에서 읽은 자료로 한다). '다 봤음' 같은 기억은 두지 않는다(새 저장소 없음).
// 글은 help-content.mjs 한 곳(쓰는 법 화면과 같은 글). 첫 버튼(data-fu-action)이 하는 일은 그 화면이 맡는다.
import {FIRST_USE} from './help-content.mjs';
import './help-link.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));

/** 빈 화면 안내 HTML. id = 'team' | 'meetings' | 'brief'. 없는 이름이면 ''. */
export function firstUseHtml(id) {
  const fu = FIRST_USE[id];
  if (!fu) return '';
  const steps = fu.steps.map(([text, ex], i) => `<li class="fu-step"><span class="fu-n" aria-hidden="true">${i + 1}</span><span class="fu-t">${esc(text)}${ex ? `<small class="fu-ex">${esc(ex)}</small>` : ''}</span></li>`).join('');
  return `<section class="fu-card" data-first-use="${esc(id)}" aria-label="처음 쓰는 법"><p class="fu-title">${esc(fu.title)}</p><p class="fu-sub">${esc(fu.sub)}</p>`
    + `<ol class="fu-steps">${steps}</ol><div class="fu-acts"><button type="button" class="primary mini" data-fu-action="${esc(id)}">${esc(fu.action)}</button>`
    + `<button type="button" class="secondary mini" data-help-open="${esc(id)}">쓰는 법 보기</button></div>${fu.foot ? `<p class="fu-foot">${esc(fu.foot)}</p>` : ''}</section>`;
}
/** 같은 안내를 노드로(DOM으로 그리는 화면용). */
export function firstUseEl(id) {
  const t = document.createElement('template');
  t.innerHTML = firstUseHtml(id);
  return t.content.firstElementChild;
}
