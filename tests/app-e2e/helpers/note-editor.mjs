import { expect } from '@playwright/test';
// ED③ 노트: the note's body is the new editor (ProseMirror) — in the note's edit field ([data-note-body-field]) and in its big window
// (#edWindow). These helpers type into it the way a person does (select all, type), so the editor's own rules run.
export const noteField=page=>page.locator('[data-note-detail] [data-note-body-field] .ProseMirror');
export const edWin=page=>page.locator('#edWindow');
export const edWinText=page=>page.locator('#edWindow .ed-window-body .ProseMirror');
export async function typeInto(page,box,text){
  await expect(box).toBeVisible();
  await box.click();
  await page.keyboard.press('Control+A');
  if(!text){await page.keyboard.press('Backspace');return;}
  // Shift+Enter is a line break inside one paragraph; a blank line (two \n) starts a new paragraph.
  const parts=String(text).split(/\n\n/);
  for(let i=0;i<parts.length;i++){
    if(i)await page.keyboard.press('Enter');
    const lines=parts[i].split('\n');
    for(let j=0;j<lines.length;j++){if(j)await page.keyboard.press('Shift+Enter');if(lines[j])await page.keyboard.insertText(lines[j]);}
  }
}
