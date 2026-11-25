// S70-12 UI-확인창끌기: 작은 확인창(.kptu-ask)을 마우스로 끄는 시험 도우미(confirm-drag.spec.mjs·standard-interactions.spec.mjs D7).
export const askBox=async l=>{const b=await l.boundingBox();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}};
// 창 안 한 점(at: 창 왼쪽 위 기준 px)을 마우스 왼쪽 단추로 잡고 dx,dy만큼 여러 걸음에 나눠 끈 뒤 놓는다.
export async function dragAsk(page,ask,{at,dx,dy}){
  const b=await ask.boundingBox(),x=b.x+at.x,y=b.y+at.y;
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=6;i++)await page.mouse.move(x+dx*i/6,y+dy*i/6);
  await page.mouse.up();
}
// 창의 빈 곳: 글 줄(.kptu-ask-text) 왼쪽 안쪽.
export async function askTextSpot(ask){const a=await ask.boundingBox(),t=await ask.locator('.kptu-ask-text').boundingBox();return {x:t.x-a.x+Math.min(20,t.width/2),y:t.y-a.y+t.height/2}}
