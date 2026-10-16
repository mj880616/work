// UI-디자인기준 1/3 보완(8-9c2): [AI에게 맡기기]·[AI 정리 결과 넣기]·[ChatGPT용 요청 복사]는
// 바구니 머리줄의 [⋯ 더보기](<details>) 안에 있다. 닫혀 있으면 사람처럼 눌러 연다.
export async function openBasketMore(page){
 const more=page.locator('#basketView [data-basket-more]');
 if(!await more.evaluate(details=>details.open))await more.locator('summary').click();
}
