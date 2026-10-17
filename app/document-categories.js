// UI-바구니첨부메모 B1: 자료 분류 7개. 저장된 값은 바꾸지 않고, 화면에서만 7개로 대응해 보여 준다.
// 예전 자동분류 12개 이름(library-files)은 아래 표로 대응하고, 표에 없는 값은 7개 이름으로 시작하면 그 분류, 아니면 '기타'로 본다.
// 분류 목록 저장·편집(추가·이름 바꾸기·삭제)은 DB 적용 뒤 PR 3에서 이 목록을 대신한다.
export const DOCUMENT_CATEGORIES=Object.freeze(['교섭','투쟁','교육','선전','정책','회의','기타']);
const LEGACY=Object.freeze({
  교섭자료:'교섭',
  교육자료:'교육',
  보도자료:'선전',취재요청:'선전','성명·논평':'선전','선전·언론자료':'선전',
  국회자료:'정책',정부자료:'정책','토론회·발제자료':'정책',
  회의자료:'회의',회의결과:'회의',
});
export function categoryOf(value){
  const name=String(value??'').trim();
  if(DOCUMENT_CATEGORIES.includes(name))return name;
  // 직접 적은 값(예: 정책자료)은 7개 이름으로 시작하면 그 분류로 본다.
  return LEGACY[name]||DOCUMENT_CATEGORIES.find(c=>name.startsWith(c))||'기타';
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// <select> 안의 <option> 목록. empty가 있으면 맨 앞에 값 없는 선택지(예: 자동 분류)를 둔다.
export function categoryOptions(selected,{empty=''}={}){
  const value=selected===''&&empty?'':categoryOf(selected);
  return (empty?`<option value=""${value===''?' selected':''}>${esc(empty)}</option>`:'')+DOCUMENT_CATEGORIES.map(name=>`<option value="${esc(name)}"${name===value?' selected':''}>${esc(name)}</option>`).join('');
}
// 자료 줄의 작은 분류 꼬리표.
export function categoryTag(value){
  const name=categoryOf(value);
  return `<span class="doc-category-tag" data-doc-category="${esc(name)}">${esc(name)}</span>`;
}
