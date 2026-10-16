// UI-디자인기준 1/3 보완(8-9c2): [분류 요청]·[분류 결과 입력]·[GPT 답변 가져오기](2/3에서 이름만 바꿈)는
// 바구니 머리줄의 [⋯ 더보기](<details>) 안에 있다. 닫혀 있으면 사람처럼 눌러 연다.
export async function openBasketMore(page){
 const more=page.locator('#basketView [data-basket-more]');
 if(!await more.evaluate(details=>details.open))await more.locator('summary').click();
}
