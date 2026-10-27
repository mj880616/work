import {expect} from '@playwright/test';

// UI-PC프로젝트좌우: on a PC (≥1024px) the projects screen shows the chosen project's detail in the right pane
// (#ps3DetailPane) instead of a dialog. The same element (#ps3DetailModal) is moved there with data-ps3-docked="1";
// its × is hidden (another row switches the pane) and the first or last-seen project is shown without a click.
// Phones and middle widths keep the dialog with its ×.
export const projectDetailDocked=page=>page.locator('#ps3DetailModal').evaluate(m=>m.dataset.ps3Docked==='1');

// Waits until the detail shows the project (pane or dialog) and is drawn: the body belongs to it and is visible.
export async function expectProjectDetail(page,id){
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  if(id)await expect(page.locator('#ps3Body')).toHaveAttribute('data-project',id);
  await expect(page.locator('#ps3Body')).toBeVisible();
}

// Leaves the detail before the next step: the dialog closes with its ×; the PC pane stays (a row click switches it).
// Returns true when a dialog was closed.
export async function closeProjectDetail(page){
  if(await projectDetailDocked(page)){await expect(page.locator('#ps3DetailPane')).toBeVisible();return false}
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  return true;
}

// The scrolling box of the detail: the pane on a PC, the dialog card elsewhere.
export const projectDetailScroller=async page=>(await projectDetailDocked(page))?'#ps3DetailPane':'#ps3DetailModal .modal-card';
