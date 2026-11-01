// WEEKLY-화면디자인정리(요청함 11/01 01:22, 명진 시안 "ㅇㅋ" 01:28): 주간 정리 화면의 줄 끝 작은 ⋯ 하나 + 누르면 작은 메뉴([고치기]·[지우기/빼기]).
// 줄마다 큰 버튼이 줄바꿈되어 한 줄씩 차지하던 것을 이 부품 하나로 모은다. 모양은 기존 ⋯(<details class="journal-kind-more">, 점은 공용 .more-dots)을
// 그대로 쓰고, 열린 버튼들은 줄 아래로 밀지 않고 ⋯ 바로 아래 오른쪽 맞춤의 작은 글자 줄 메뉴(journal.css .row-more-menu)로 뜬다.
// 키보드·터치: 기본 <details>/<summary>(Enter·Space로 열기), Esc·바깥 누르기·메뉴 항목 누르기로 닫힘, 한 번에 하나만 열림.
// 메뉴 버튼은 원래 버튼의 data-* 그대로라 화면마다의 누르기 처리는 바뀌지 않는다. 브라우저 저장소에 아무것도 두지 않는다.
const wired = new WeakSet();
function wire(doc) {
  if (wired.has(doc)) return;
  wired.add(doc);
  doc.addEventListener('toggle', event => {
    const box = event.target;
    if (!box?.matches?.('details.row-more') || !box.open) return;
    for (const other of doc.querySelectorAll('details.row-more[open]')) if (other !== box) other.open = false;
  }, true);
  doc.addEventListener('click', event => {
    for (const box of doc.querySelectorAll('details.row-more[open]')) {
      if (!box.contains(event.target) || event.target.closest?.('.row-more-menu button')) box.open = false;
    }
  });
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const box = doc.querySelector('details.row-more[open]');
    if (!box) return;
    event.preventDefault(); event.stopImmediatePropagation();
    box.open = false; box.querySelector('summary')?.focus();
  }, true);
}

// label: ⋯ 의 읽기 이름(예: '가상 안건 고치기·빼기'). items: [{text, data:{datasetKey:value}, aria, disabled, danger}].
// data: <details> 자신에게 붙일 data-*. 반환 <details class="journal-kind-more row-more">.
export function rowMore(doc, {label, items, data = {}}) {
  wire(doc);
  const box = doc.createElement('details'); box.className = 'journal-kind-more row-more';
  for (const [key, value] of Object.entries(data)) box.dataset[key] = value;
  const sum = doc.createElement('summary'); sum.setAttribute('aria-label', label);
  const dots = doc.createElement('span'); dots.className = 'more-dots'; dots.setAttribute('aria-hidden', 'true'); dots.textContent = '⋯';
  sum.append(dots);
  const menu = doc.createElement('div'); menu.className = 'row-more-menu'; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', label);
  for (const item of items) {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = item.text;
    if (item.danger) b.className = 'row-more-danger';
    for (const [key, value] of Object.entries(item.data ?? {})) b.dataset[key] = value;
    if (item.aria) b.setAttribute('aria-label', item.aria);
    if (item.disabled) b.disabled = true;
    menu.append(b);
  }
  box.append(sum, menu);
  return box;
}

// 묶음 제목 줄 오른쪽 작은 [+ 추가](와 같은 줄에 둘 작은 글자 버튼들). 묶음(section)에 journal-part-has-add 가 있으면 CSS가 제목 줄 오른쪽에 둔다.
export function partAdd(doc, buttons) {
  const box = doc.createElement('span'); box.className = 'journal-part-add';
  box.append(...buttons);
  return box;
}
