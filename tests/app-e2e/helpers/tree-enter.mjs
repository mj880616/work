// TREE-탐색기꺾쇠(S70-81b, 명진 11/26 09:25, T10): 넓은 화면 왼쪽 나무 = 윈도 탐색기. 이름 한 번 = 오른쪽에 그 폴더, 꺾쇠(.ft-tog) = 펼치기·접기만.
// 시험에서 '나무로 그 폴더에 들어가기'를 할 때 이 도우미를 쓴다: 이름을 한 번 누르고, 탐색기 나무에서 그 폴더가 접혀 있으면 꺾쇠로 펼친다
//  (앞 규칙들 — S69-38 '누르면 오른쪽 + 펼치기', S70-81 '처음 펼치기·다시 들어가기' — 이 끝에 남기던 '들어감 + 펼침' 상태를 그대로 만든다).
// 폰 나무·목록은 그 자리 펼치기(T5)라 이름 한 번(그 화면 그대로).
// main = 나무 줄의 이름 단추(.ft-main) locator. 누른 횟수(이름 + 꺾쇠)를 돌려준다.
// 나무를 다시 그리는 중(서버에서 읽은 하위 폴더·처음 그리기)에 상태를 읽거나 누르면 옛 줄과 새 줄이 갈린다(누르기 내림·올림이 다른 줄에 닿아 click이 없다).
// 사람처럼 나무가 조용해진 뒤(120ms 동안 바뀌지 않음, 길어야 3초) 읽고 누른다.
const settle = main => main.evaluate(m => new Promise(done => {
  const box = m.closest('[role="tree"], [data-fx-tree], [data-nx-tree], #libraryFolderNav, [data-photos-fx-tree]') || document.body;
  let t = setTimeout(end, 120); const stop = setTimeout(end, 3000);
  const ob = new MutationObserver(() => { clearTimeout(t); t = setTimeout(end, 120); });
  ob.observe(box, { subtree: true, childList: true, attributes: true });
  function end() { ob.disconnect(); clearTimeout(t); clearTimeout(stop); done(); }
})).catch(() => {});

// options.tap = 손가락 누르기(locator.tap), 나머지는 click 옵션.
export async function treeEnter(main, options = {}) {
  const { tap = false, ...opts } = options;
  await main.waitFor();
  await settle(main);
  const explorer = await main.evaluate(m => {
    const r = m.closest('.ft-row, .nx-row');
    // 탐색기 나무(ftExplorePress가 맡는 곳)인지 — 화면마다 넓은 화면 기준이 다르다(앱 판정과 같은 값).
    const w = innerWidth;
    return !!r && r.classList.contains('ft-has-tog') && (r.closest('#libraryFolderNav') ? true
      : r.closest('[data-nx-tree]') ? w >= 600
      : r.closest('[data-photos-fx-tree]') ? w >= 1200
      : !!r.closest('[data-fx-tree]') && !r.closest('[data-fx-ptree]') && r.matches('[data-fx-fold]'));
  });
  await (tap ? main.tap(opts) : main.click(opts));
  if (!explorer) return 1;
  await settle(main);
  const tog = main.locator('xpath=..').locator(':scope > button.ft-tog[aria-expanded="false"]');
  if (!(await tog.count())) return 1;
  await (tap ? tog.tap() : tog.click());
  return 2;
}
