// NOTE-노션편집 ①(가): 편집기 서식 줄은 모든 폭에서 폰 묶음 줄(글자·문단·넣기·기호 ▾)이다. 넓은 화면은 묶음 앞 버튼 몇 개가 줄 위에 나와 있고
// 나머지는 묶음 목록 안에 있다. 이 도우미는 버튼이 줄 위에 있으면 바로 누르고, 묶음 안에 있으면 그 묶음 버튼을 먼저 연 뒤 누른다.
// scope: page 또는 편집기를 품은 locator. name: 버튼의 접근 이름(글자 또는 aria-label). tap: 터치로 누르기.
export async function edPress(scope, name, {tap = false} = {}) {
  const bar = scope.locator('.ed-bar').first();
  const b = bar.getByRole('button', {name, exact: true, includeHidden: true}).first();
  const group = await b.evaluate(el => el.closest('[data-ed-panel]')?.dataset.edPanel || null);
  const hit = l => (tap ? l.tap() : l.click());
  if (group && !(await b.isVisible())) await hit(bar.locator(`.ed-tools [data-ed-cmd="${group}"]`));
  await hit(b);
}
// 줄을 왼쪽부터 읽고, 묶음 버튼 자리에서 그 묶음 목록을 이어 읽은 순서(data-ed-cmd). 폭과 관계없이 같아야 한다.
export const edFlatOrder = scope => scope.locator('.ed-bar').first().evaluate(bar => {
  const out = [];
  for (const b of bar.querySelector('.ed-tools').children) {
    const g = bar.querySelector(`[data-ed-panel="${b.dataset.edCmd}"]`);
    if (g) out.push(...[...g.children].map(c => c.dataset.edCmd)); else if (!b.hidden) out.push(b.dataset.edCmd);
  }
  return out;
});
// data-ed-cmd 이름으로 누르기(줄 위면 바로, 묶음 안이면 묶음을 먼저 연다). scope: 편집기를 품은 locator.
export async function edCmd(scope, cmd, {tap = false} = {}) {
  const b = scope.locator(`.ed-bar [data-ed-cmd="${cmd}"]`).first();
  const group = await b.evaluate(el => el.closest('[data-ed-panel]')?.dataset.edPanel || null);
  const hit = l => (tap ? l.tap() : l.click());
  if (group && !(await b.isVisible())) await hit(scope.locator(`.ed-bar .ed-tools [data-ed-cmd="${group}"]`).first());
  await hit(b);
}
