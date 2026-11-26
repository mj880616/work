// NEWS-출처목록가나다(11/15 사용자 "모든 곳은 가나다 정렬"): 이름을 골라 켜거나 고르는 목록의 화면 순서를 정하는 유일한 함수.
// 한국어 정렬 규칙 한 가지(localeCompare 'ko', 숫자는 크기대로): 숫자로 시작하는 이름 → 한글 가나다 → 영어 ABC(대소문자 무시).
// 화면마다 따로 정렬하지 않고 이 함수를 부른다. 사람이 정한 순서(조직 순서·끌어 바꾼 순서)·날짜순 목록·묶음 자체 순서에는 쓰지 않는다.
// DOM·네트워크 없음.
const collator = typeof Intl === 'object' && typeof Intl.Collator === 'function' ? new Intl.Collator('ko', {numeric: true, sensitivity: 'base'}) : null;
const text = v => String(v ?? '').trim();

// 두 이름 비교(-1·0·1). 같으면 0.
export function compareName(a, b) {
  const x = text(a), y = text(b);
  const c = collator ? collator.compare(x, y) : x.localeCompare(y, 'ko', {numeric: true, sensitivity: 'base'});
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

// 목록을 이름 가나다순으로 새 배열에 담아 돌려준다(원본은 그대로). nameOf: 줄 → 이름 글자(기본 .name).
// 이름이 같으면 key·id, 그래도 같으면 원래 순서(안정 정렬)로 늘 같은 순서가 된다.
export function sortByName(list, nameOf = row => row?.name) {
  const tie = row => text(row?.key ?? row?.id ?? '');
  return (Array.isArray(list) ? list : []).map((row, i) => ({row, i}))
    .sort((p, q) => compareName(nameOf(p.row), nameOf(q.row)) || (tie(p.row) < tie(q.row) ? -1 : tie(p.row) > tie(q.row) ? 1 : 0) || p.i - q.i)
    .map(p => p.row);
}
