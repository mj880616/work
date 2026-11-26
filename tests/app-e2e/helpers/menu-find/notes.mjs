import {openHome} from '../home-entry.mjs';
import {chooseBasketKind} from '../basket-kind.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 노트(S70-54 ②): 맨 위 칸 '노트에서 찾기' = 노트 목록 query → renderList.
export default {
  name:'노트',label:'노트에서 찾기',query:'기본급',before:2,after:1,match:'가상 임금 정리',
  rows:page=>page.locator('#noteRows [data-note-row]'),
  async open(page){
    const at='2026-10-05T01:00:00Z';
    const note=(id,title,raw_text)=>({id,workspace_id:'w',kind:'note',title,raw_text,occurred_at:at,created_at:at,updated_at:at,archived_at:null,metadata:{}});
    const rows=[note('n1','가상 임금 정리','기본급 인상'),note('n2','가상 회의 메모','다음 회의 준비')];
    await openHome(page);
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{const q=new URL(r.request().url()).searchParams;
      if(r.request().method()!=='GET')return r.fallback();if(q.get('metadata'))return r.fulfill({json:[]});
      return r.fulfill({json:rows.filter(x=>!q.get('kind')||'eq.'+x.kind===q.get('kind'))})});
    await chooseBasketKind(page,'note');
  },
};
