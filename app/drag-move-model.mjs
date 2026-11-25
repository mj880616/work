// S70-12 UI-확인창끌기: 떠 있는 작은 창을 끌어 옮길 때의 계산만(DOM 없음). 끄는 일은 anchored-popup.js dragByTitle 하나가 하고,
// 그 부품을 쓰는 창(버튼 옆 고르기 창·자주 가는 링크 창·작은 확인창 .kptu-ask)이 모두 이 규칙을 따른다. 옮긴 자리는 저장하지 않는다(닫으면 잊음).

// 이 위에서 누르면 끌기가 아니라 그 칸의 동작(누르기·글 쓰기·체크)이다.
export const NO_DRAG_START='button,a,input,select,textarea,label,[contenteditable]:not([contenteditable="false"])';
// 이만큼(px, 가로+세로) 움직이기 전까지는 끌기가 아니다: 짧게 누르기·글 고르기는 그대로.
export const DRAG_SLOP=4;

// 끌기를 시작해도 되는 누름인가. target은 closest()가 있는 칸(Element). mouseOnly면 마우스 왼쪽 단추만(손가락·펜은 그대로 둔다).
export function dragStartOk({button=0,pointerType='mouse',target=null}={},{mouseOnly=false}={}){
  if(button!==0)return false;
  if(mouseOnly&&pointerType!=='mouse')return false;
  if(!target||typeof target.closest!=='function')return false;
  return !target.closest(NO_DRAG_START);
}

export const passedSlop=(dx,dy,slop=DRAG_SLOP)=>Math.abs(dx)+Math.abs(dy)>=slop;

const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
// 끈 거리(dx,dy)만큼 옮긴 새 자리. 창(vw×vh)의 가장자리 edge px 안에 가둔다. 창보다 큰 판은 왼쪽·위 끝을 edge에 둔다.
export function movedSpot({left,top,dx,dy,width,height,vw,vh,edge=8}){
  return {left:clamp(left+dx,edge,Math.max(edge,vw-edge-width)),top:clamp(top+dy,edge,Math.max(edge,vh-edge-height))};
}
