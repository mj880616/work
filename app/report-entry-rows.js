// MTG-보고창정리: 입력·수정 창에서 칸(활동 종류)에 따라 나오거나 빠지는 입력 줄의 그리는 주인.
// 안 보일 때는 숨기지(hidden·display) 않고 창에서 빼 둔다. 라벨이 자기 display를 가져 hidden 속성을 이기는 일이 없다.
// 빠진 줄의 칸(input)은 그대로 들고 있어 값이 지워지지 않고, 다시 나오면 같은 자리로 돌아온다.
// ids는 줄 안 입력 칸 id들(같은 라벨 안). 첫 호출 때 창에서 줄을 잡고, 첫 줄 앞에 표식(주석)을 남긴다.
export function createFieldRows(ids){
  let rows=null,anchor=null;
  const grab=()=>{
    if(rows)return true;
    const found=ids.map(id=>document.getElementById(id)?.closest('label'));
    if(found.some(label=>!label))return false;
    rows=found;anchor=document.createComment('field-rows:'+ids[0]);rows[0].before(anchor);return true;
  };
  return {
    // show가 참이면 줄을 창에 두고, 거짓이면 뺀다. 이미 그 상태면 아무것도 하지 않는다.
    paint(show){
      if(!grab())return false;
      const on=!!show&&rows[0].isConnected;
      if(show&&!on&&anchor.parentNode)anchor.after(...rows);
      else if(!show&&rows[0].isConnected)rows.forEach(row=>row.remove());
      return rows[0].isConnected;
    },
    get shown(){return !!rows&&rows[0].isConnected}
  };
}
