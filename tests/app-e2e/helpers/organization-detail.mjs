import {expect} from '@playwright/test';

// ORG-PC좌우: on a PC (≥761px) the 담당조직 screen shows the chosen organization's detail in the right pane (#wdDetailPane)
// instead of a dialog. The same element (#wdModal) is moved there with data-wd-docked="1"; its × is hidden (another row
// switches the pane) and the first or last-seen organization is shown without a click. Phones and a detail
// opened over another screen keep the dialog with its ×. Same shape as helpers/project-detail.mjs.
export const organizationDetailDocked=page=>page.locator('#wdModal').evaluate(m=>m.dataset.wdDocked==='1');

// Leaves the detail before the next step: the dialog closes with its ×; the PC pane stays (a row click switches it).
// Returns true when a dialog was closed.
export async function closeOrganizationDetail(page){
  if(await organizationDetailDocked(page)){await expect(page.locator('#wdDetailPane')).toBeVisible();return false}
  await page.locator('[data-wd-close="wdModal"]').click();
  await expect(page.locator('#wdModal')).toBeHidden();
  return true;
}
