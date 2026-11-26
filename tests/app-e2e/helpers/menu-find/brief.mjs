import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const D=n=>`d7057000-0000-4000-8000-00000000000${n}`;
// 브리핑 룸(S70-57): 맨 위 칸 '브리핑 룸에서 찾기' = 목록 줄 자료 이름·파일 이름·한 줄 요지 거르기(brief-room.js drawList). 자료 이름은 지어낸 것.
const docs=[['가상 철도 계획','예시 계획.pdf'],['예시 병원 보고서','예시 보고서.pdf'],['예시 학교 편람','예시 편람.pdf']].map(([title,file_name],i)=>({
  id:D(i+1),workspace_id:'w',category:'기타',visibility:'private',title,file_name,mime_type:'application/pdf',file_id:'FILE_'+'abc'[i].repeat(10),created_at:`2026-10-0${6-i}T00:00:00Z`}));
export default {
  name:'브리핑 룸',label:'브리핑 룸에서 찾기',query:'철도',before:3,after:1,match:'가상 철도 계획',
  rows:page=>page.locator('#briefView [data-br-list] .br-row'),
  async open(page){
    await openHome(page,{beforeLoad:async()=>{
      await page.route(SB+'/rest/v1/app_document_briefs**',r=>r.fulfill({json:[]}));
      await page.route(SB+'/rest/v1/app_library_folders**',r=>r.fulfill({json:r.request().method()==='GET'?[{id:'f-brief'}]:[]}));
      await page.route(SB+'/rest/v1/app_library_folder_items**',r=>r.fulfill({json:docs.map(d=>({document_id:d.id}))}));
      await page.route(SB+'/rest/v1/app_documents?**',r=>r.request().method()==='GET'&&new URL(r.request().url()).searchParams.get('id')?.startsWith('in.')?r.fulfill({json:docs}):r.fallback());
    }});
    await page.evaluate(()=>window.KPTURouter.go('brief'));
    await expect(page.locator('#briefView')).toBeVisible();
  },
};
