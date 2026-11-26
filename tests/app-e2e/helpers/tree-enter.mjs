// TREE-펼치기먼저(S70-81, 명진 11/26): 넓은 화면 왼쪽 나무 폴더 이름 누르기 = 처음은 펼치기만(펼칠 게 없으면 골라짐), 다시 누르면 오른쪽에 그 폴더.
// 시험에서 '나무로 그 폴더에 들어가기'를 할 때 이 도우미를 쓴다(앱 판정 explorePressPlan과 같은 순서로 누른다).
//  지금 폴더 = 한 번(닫혀 있으면 펼치기만), 펼쳐진 폴더·골라진 폴더 = 한 번(들어가기), 그 밖 = 두 번(펼치기·골라짐 → 들어가기).
// 넓은 화면(탐색기 나무)에서만 두 번 누른다 — 폰 나무·목록은 그 자리 펼치기(T5)라 한 번(그 화면 그대로).
// main = 나무 줄의 이름 단추(.ft-main) locator. 몇 번 눌렀는지 돌려준다.

// 나무를 다시 그리는 중(서버에서 읽은 하위 폴더·처음 그리기)에 상태를 읽거나 누르면 옛 줄과 새 줄이 갈린다(누르기 내림·올림이 다른 줄에 닿아 click이 없다).
// 사람처럼 나무가 조용해진 뒤(120ms 동안 바뀌지 않음, 길어야 3초) 읽고 누른다.
const settle = main => main.evaluate(m => new Promise(done => {
  const box = m.closest('[role="tree"], [data-fx-tree], [data-nx-tree], #libraryFolderNav, [data-photos-fx-tree]') || document.body;
  let t = setTimeout(end, 120); const stop = setTimeout(end, 3000);
  const ob = new MutationObserver(() => { clearTimeout(t); t = setTimeout(end, 120); });
  ob.observe(box, { subtree: true, childList: true, attributes: true });
  function end() { ob.disconnect(); clearTimeout(t); clearTimeout(stop); done(); }
})).catch(() => {});

export async function treeEnter(main, options = {}) {
  await main.waitFor();
  await settle(main);
  const need = await main.evaluate(m => {
    const r = m.closest('.ft-row, .nx-row');
    // 탐색기 나무(ftExplorePress가 맡는 곳)인지 — 화면마다 넓은 화면 기준이 다르다(앱 판정과 같은 값).
    const w = innerWidth;
    const explorer = !!r && (r.closest('#libraryFolderNav') ? true
      : r.closest('[data-nx-tree]') ? w >= 600
      : r.closest('[data-photos-fx-tree]') ? w >= 1200
      : !!r.closest('[data-fx-tree]') && !r.closest('[data-fx-ptree]') && r.matches('[data-fx-fold]'));
    if (!explorer) return 1;
    if (!r.classList.contains('ft-has-tog')) return 1; // '자료실 전체'처럼 폴더가 아닌 맨 위 줄은 한 번에 연다
    if (r.classList.contains('ft-current') || m.getAttribute('aria-current') === 'true') return 1;
    if (r.classList.contains('ft-armed')) return 1;
    const tog = r.querySelector(':scope > button.ft-tog[aria-expanded]');
    return tog?.getAttribute('aria-expanded') === 'true' ? 1 : 2;
  });
  await main.click(options);
  if (need > 1) {
    await settle(main);
    await main.click(options);
  }
  return need;
}
