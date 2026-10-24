// ED③ 업데이트: the top line's [+ 추가] → [업데이트] now opens the update's new big window (#edWindow, app/update-window.js).
// - openWriteFromEntry: the real click path (nothing else is faked) and waits for the new editor.
// - openOldWriteWindow: the OLD shell (#mdEditor, write-window.js / md-editor.js) is still used by the organization and project record
//   inputs until ED③ 순서 5·6 delete it, so the specs of that shell keep opening it by a script that does what the top line used to do
//   (the draft kept in this tab's memory, a saved note handed to the basket).
export async function openWriteFromEntry(page,width){
  // Below 1024px the old way went through the basket screen first, and callers expect to start from there.
  if(width<1024&&await page.evaluate(()=>window.KPTURouter.current)!=='basket'){await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('#basketView [data-basket-list]').waitFor();}
  // The old ⤢ press scrolled the page to the input (callers that scrolled first relied on that); the menu press does not, so go to the top.
  if(width<1024)await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('#appView>.app-topline [data-quick-add]').evaluate(b=>b.click());// no scroll-into-view: callers may test the scroll position
  await page.locator('#toplineAddMenu [data-topline-add="update"]').evaluate(b=>b.click());
  await page.locator('#edWindow .ed-window-body .ProseMirror').waitFor();
}
export async function openOldWriteWindow(page,width){
  if(width<1024&&await page.evaluate(()=>window.KPTURouter.current)!=='basket'){await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('#basketView [data-basket-list]').waitFor();}
  if(width<1024)await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(async()=>{
    const [{openWriteWindow},{requestNoteDocOpen}]=await Promise.all([import('/app/write-window.js'),import('/app/basket-note-tasks.js'),window.KPTUViewLoader?.prepare?.('basket')]);
    window.__oldWriteDraft??='';
    openWriteWindow({text:window.__oldWriteDraft,title:'쓰기',kind:'update',onClose:(text,{saved})=>{
      if(saved){
        window.__oldWriteDraft='';
        if(saved.kind!=='note')return;
        requestNoteDocOpen(saved.id);
        const go=()=>window.KPTURouter?.go('basket',{source:'delegated'});
        if(history.state?.kptuOverlay==='mdEditor')window.addEventListener('popstate',()=>queueMicrotask(go),{once:true});else go();
        return;
      }
      window.__oldWriteDraft=text.trim()?text:'';
    }});
  });
  await page.locator('#mdEditor .md-editor-text').waitFor();
}
// The old big editor (md-editor.js) on the basket update's edit box, exactly as the basket screen used to open it before ED③ 업데이트
// (the box follows every change, closing hands the text back to the box, the save icon is the screen's [수정 저장]). The basket screen now opens
// the new window; the old editor's own specs keep reaching it this way until ED③ 순서 6 deletes it.
export async function openOldBigEditorOnBasketField(page){
  await page.evaluate(async()=>{
    const {openMarkdownEditor}=await import('/app/md-editor.js');
    const field=document.querySelector('[data-basket-detail] [data-basket-text]');
    window.__oldBigEditor=openMarkdownEditor({text:field.value,title:'큰 창에서 수정',
      save:{aria:'업데이트 저장',run:async value=>{field.value=value;document.querySelector('[data-basket-detail] [data-basket-save]').click();return {ok:true};}},
      onInput:value=>{field.value=value;},
      onClose:value=>{field.value=value;field.focus();}});
  });
  await page.locator('#mdEditor').waitFor();
}
