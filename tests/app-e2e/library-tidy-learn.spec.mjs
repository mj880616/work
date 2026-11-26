import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc,libFolder,press} from './helpers/library-folder-server.mjs';
// S69-16 LIB-정돈본보기(사용자 11/24 08:26 '내가 손으로 다 나눠 둘 테니 이걸 배워서 앞으로 이렇게 정돈'):
// [정돈 제안]이 사람이 이미 깊은 폴더에 넣어 둔 자료를 본보기로, 받는 폴더 자료마다 가장 닮은 깊은 폴더를 '닮은 자료' 까닭과 함께 제안하고,
// 닮은 폴더가 여럿이면 옮기지 않고 고르게 하며, 사람이 넣어 둔 자료는 옮기지 않는지 본다. 손으로 옮긴 뒤 다시 열면 제안이 따라오는지도 본다.
// 가짜 서버·지어낸 이름만.
const u=n=>`5f300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=u(1),AM=u(2),AMR=u(3),AMX=u(4),B=u(5),BM=u(6),BMX=u(7),RCV=u(8);
const FOLDERS=[libFolder(A,null,{name:'가상궤도',sort_order:1024}),libFolder(AM,null,{name:'회의',parent_id:A,sort_order:1024}),
  libFolder(AMR,null,{name:'대표자',parent_id:AM,sort_order:1024}),libFolder(AMX,null,{name:'집행위',parent_id:AM,sort_order:2048}),
  libFolder(B,null,{name:'가상팀',sort_order:2048}),libFolder(BM,null,{name:'회의',parent_id:B,sort_order:1024}),libFolder(BMX,null,{name:'집행위',parent_id:BM,sort_order:1024}),
  libFolder(RCV,null,{name:'잡동사니',sort_order:3072})];
const FILED=[[u(101),'가상궤도협의회 3차 대표자회의자료',AMR],[u(102),'가상궤도 대표자회의 회의록',AMR],[u(103),'가상궤도협의회 2차집행위원회회의자료',AMX],[u(104),'가상궤도 집행위 회의록',AMX],
  [u(105),'43차 본부집행위원회 회의자료',BMX],[u(106),'44차 본부집행위원회 회의자료',BMX],[u(107),'가상팀 집행위 회의록',BMX]];
const NEW_R=u(201),NEW_X=u(202),AMBI=u(203);
const INBOX=[[NEW_R,'가상궤도협의회 제7차 대표자회의자료'],[NEW_X,'45차 본부집행위원회 회의자료'],[AMBI,'집행위 회의록']];
const DOCS=[...FILED,...INBOX].map(([id,title])=>libDoc(id,null,{title}));
const ITEMS=[...FILED.map(([document_id,,folder_id])=>({document_id,folder_id})),...INBOX.map(([document_id])=>({document_id,folder_id:RCV}))];
const modal=page=>page.locator('#libraryTidyModal');
const group=(page,gid)=>modal(page).locator(`[data-tidy-group="${gid}"]`);
const folderOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;
async function openTop(page,width){
  await press(page,page.locator('#libraryTopMenuBtn'),width);
  await press(page,page.locator('#luTopMenu [data-lu-top="tidy"]'),width);
  await expect(modal(page)).toBeVisible();
}

for(const [label,width,touch] of [['PC 1280',1280,false],['폰 412',412,true]]){
  test.describe(label,()=>{
    test.use({hasTouch:touch,isMobile:touch});
    test('본보기로 깊은 폴더 제안 → 애매하면 고르기 → 옮기기 → 손으로 옮긴 뒤 다시 열면 따라옴',async({page,browser})=>{
      const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS.map(d=>({...d})),group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RCV}});
      await openTop(page,width);
      await expect(modal(page).locator('#libraryTidySub')).toContainText('닮은 폴더가 있는 자료 2묶음');
      await expect(modal(page).locator('#libraryTidySub')).toContainText('선택할 자료 1묶음');
      // 새 대표자회의 자료 → 가상궤도 › 회의 › 대표자, 본부 집행위 자료 → 가상팀 › 회의 › 집행위(같은 '집행위' 이름이어도 갈림).
      const r=group(page,`e:${AMR}`),x=group(page,`e:${BMX}`);
      await expect(r.locator('[data-tidy-pick]')).toContainText('가상궤도 › 회의 › 대표자');
      await expect(r.locator(`[data-tidy-row="${NEW_R}"] .lu-sort-why`)).toHaveText(/^닮은 자료: .*대표자회의/);
      await expect(x.locator('[data-tidy-pick]')).toContainText('가상팀 › 회의 › 집행위');
      await expect(x.locator(`[data-tidy-row="${NEW_X}"] .lu-sort-why`)).toHaveText(/^닮은 자료: 43차 본부집행위원회 회의자료/);
      // 두 '집행위'가 비슷하게 닮은 자료는 고르기(기본 그대로).
      const p=modal(page).locator('[data-tidy-group^="p:"]');
      await expect(p.locator('[data-tidy-mode="keep"]')).toHaveAttribute('aria-pressed','true');
      await expect(p).toContainText('닮은 폴더가 여럿');
      await expect(p).toContainText('집행위 회의록');
      // 사람이 넣어 둔 자료는 어느 묶음에서도 체크되지 않는다.
      for(const [id] of FILED){const c=modal(page).locator(`[data-tidy-row="${id}"] [data-tidy-check]`);if(await c.count())await expect(c).not.toBeChecked()}
      await expect(modal(page).locator('[data-tidy-apply]')).toHaveText('선택한 2개 옮기기');
      expect(s.writes.filter(w=>w.method!=='GET')).toEqual([]);
      await press(page,modal(page).locator('[data-tidy-apply]'),width);
      await expect(modal(page)).toBeHidden();
      expect(folderOf(s,NEW_R)).toBe(AMR);expect(folderOf(s,NEW_X)).toBe(BMX);expect(folderOf(s,AMBI)).toBe(RCV);
      for(const [id,,f] of FILED)expect(folderOf(s,id)).toBe(f);
      // 손으로 옮기기(다른 기기에서 옮긴 것처럼 서버 자리만 바꿈): 대표자회의 자료 셋을 '가상팀 › 회의 › 집행위'로 → 새 대표자회의 자료 제안도 그리로.
      for(const id of [u(101),u(102),NEW_R])s.items.find(i=>i.document_id===id).folder_id=BMX;
      s.docs.push(libDoc(u(204),null,{title:'가상궤도협의회 제8차 대표자회의자료'}));s.items.push({workspace_id:'workspace-1',document_id:u(204),folder_id:RCV});
      // 다른 기기(새 브라우저)에서 같은 서버 상태로 다시 연다.
      const other=await browser.newPage({hasTouch:touch,isMobile:touch});
      try{
        const o=await bootLibrary(other,width,{state:s,group:'폴더'});
        await openTop(other,width);
        const row=modal(other).locator(`[data-tidy-row="${u(204)}"]`),sec=row.locator('xpath=ancestor::section[1]');
        await expect(row).toHaveCount(1);
        await expect(sec).toHaveAttribute('data-tidy-group',/^(e|g):/);
        await expect(sec.locator('[data-tidy-pick]').first()).toContainText('가상팀 › 회의 › 집행위');
        if(touch)expect(await other.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
        expect(o.errors).toEqual([]);
      }finally{await other.close()}
      expect(errors).toEqual([]);
    });
  });
}
