// WEEKLY-화면디자인정리(요청함 11/01 01:22, 명진 시안 "ㅇㅋ" 01:28): 주간 정리 화면의 줄 끝 작은 ⋯ 하나 + 누르면 작은 메뉴([고치기]·[지우기/빼기]).
// 줄마다 큰 버튼이 줄바꿈되어 한 줄씩 차지하던 것을 이 부품 하나로 모은다. 모양은 기존 ⋯(<details class="journal-kind-more">, 점은 공용 .more-dots)을
// 그대로 쓰고, 열린 버튼들은 줄 아래로 밀지 않고 ⋯ 바로 아래 오른쪽 맞춤의 작은 글자 줄 메뉴(journal.css .row-more-menu)로 뜬다.
// 키보드·터치: 기본 <details>/<summary>(Enter·Space로 열기), Esc·바깥 누르기·메뉴 항목 누르기로 닫힘, 한 번에 하나만 열림.
// 메뉴 버튼은 원래 버튼의 data-* 그대로라 화면마다의 누르기 처리는 바뀌지 않는다. 브라우저 저장소에 아무것도 두지 않는다.
const wired = new WeakSet();
// QA-주간정리메뉴간헐: 화면은 늦게 도착한 읽기마다 그 자리를 다시 그린다(그리는 곳은 화면마다 하나). 다시 그리면 ⋯ 도 새로 만들어져 닫힌 채
// 그려졌고, 열어 둔 메뉴가 사용자가 누르기 전에 닫혔다. 열린 ⋯ 하나를 기억해(메모리만), 같은 줄의 ⋯ 를 다시 만들 때 열린 채로 만든다.
// 같은 줄 = 읽기 이름·data-*·메뉴 버튼 data-* 가 모두 같은 것. 한 번 그리는 동안 같은 열쇠가 둘이면 처음 것 하나만 연다.
const keyOf = new WeakMap(), fresh = new WeakSet();
let openBox = null;
function wire(doc) {
  if (wired.has(doc)) return;
  wired.add(doc);
  doc.addEventListener('toggle', event => {
    const box = event.target;
    if (!box?.matches?.('details.row-more') || !box.open) return;
    openBox = box;
    for (const other of doc.querySelectorAll('details.row-more[open]')) if (other !== box) other.open = false;
  }, true);
  doc.addEventListener('click', event => {
    if (openBox && !openBox.isConnected) openBox.open = false; // 줄이 없어진 뒤 남은 기억은 다른 곳을 누르면 닫는다.
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

// label: ⋯ 의 읽기 이름(예: '가상 안건 고치기·빼기'). items: [{text, data:{datasetKey:value}, aria, disabled, danger, onClick}].
// data: <details> 자신에게 붙일 data-*. 반환 <details class="journal-kind-more row-more">.
export function rowMore(doc, {label, items, data = {}}) {
  wire(doc);
  const box = doc.createElement('details'); box.className = 'journal-kind-more row-more';
  for (const [key, value] of Object.entries(data)) box.dataset[key] = value;
  const sum = doc.createElement('summary'); sum.setAttribute('aria-label', label);
  const dots = doc.createElement('span'); dots.className = 'more-dots'; dots.setAttribute('aria-hidden', 'true'); dots.textContent = '⋯';
  sum.append(dots);
  const key = JSON.stringify([label, data, items.map(item => [item.text, item.data ?? {}])]);
  keyOf.set(box, key);
  // 지금 열린 ⋯(닫으면 .open 이 바로 false)와 같은 줄을 다시 그리는 중이면 열린 채로 — 지연 덮어쓰기 없이 만들 때 한 번.
  // (열린 직후 toggle 알림이 오기 전에 다시 그려도 되게, 기억한 것이 없으면 문서에서 열린 ⋯ 를 찾는다.)
  const cur = openBox?.open ? openBox : doc.querySelector?.('details.row-more[open]');
  if (cur && cur !== box && !fresh.has(cur) && keyOf.get(cur) === key) {
    box.open = true; openBox = box;
    for (const b of [cur, box]) { fresh.add(b); queueMicrotask(() => fresh.delete(b)); }
  }
  const menu = doc.createElement('div'); menu.className = 'row-more-menu'; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', label);
  for (const item of items) {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = item.text;
    if (item.danger) b.className = 'row-more-danger';
    for (const [key, value] of Object.entries(item.data ?? {})) b.dataset[key] = value;
    if (item.aria) b.setAttribute('aria-label', item.aria);
    if (item.disabled) b.disabled = true;
    if (typeof item.onClick === 'function') b.addEventListener('click', item.onClick); // 화면 메모리만 바꾸는 곁 처리(쓰기는 원래 data-* 처리 그대로)
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
