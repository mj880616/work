import {readFileSync} from 'node:fs';

// CI-버전자동화 3단계: the repository shell loads ./app.js without ?v=; the Pages build adds a
// content hash and the version notice compares it with the deployed index.html. Tests of the
// notice serve the shell the way the build does, with a fixed version on app.js.
export const shellVersion=300;
export async function serveBuiltShell(page,origin,version=shellVersion){
  const html=readFileSync('app/index.html','utf8');
  const tag='<script src="./app.js" defer>';
  if(!html.includes(tag))throw new Error('app/index.html no longer loads ./app.js with defer');
  const body=html.replace(tag,`<script src="./app.js?v=${version}" defer>`);
  await page.route(url=>url.origin===origin&&url.pathname==='/app/',route=>route.fulfill({contentType:'text/html',body}));
}
