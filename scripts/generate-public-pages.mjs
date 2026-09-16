import fs from 'node:fs/promises';
import path from 'node:path';
import {buildPagesQuery,renderShell} from './public-page-meta.mjs';

const ROOT=process.cwd();
const TEMPLATE_PATH=path.join(ROOT,'p','index.html');
const MANIFEST_PATH=path.join(ROOT,'p','.generated-pages.json');
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const SITE='https://mj880616.github.io/work';

// Generate a dedicated metadata shell for every published public or unlisted page.
async function loadPages(){
  const qs=buildPagesQuery();
  const r=await fetch(`${SB}/rest/v1/app_pages?${qs}`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});
  if(!r.ok)throw new Error(`public page fetch failed: ${r.status} ${await r.text()}`);
  const rows=await r.json();
  return rows.filter(x=>/^[a-z0-9-]+$/.test(String(x.slug||'')));
}

async function previousSlugs(){
  try{
    const data=JSON.parse(await fs.readFile(MANIFEST_PATH,'utf8'));
    return Array.isArray(data.slugs)?data.slugs.filter(x=>/^[a-z0-9-]+$/.test(x)):[];
  }catch{return []}
}

const template=await fs.readFile(TEMPLATE_PATH,'utf8');
if(!template.includes('PUBLIC_PAGE_META_START'))throw new Error('p/index.html is missing metadata template markers');
const pages=await loadPages();
const slugs=pages.map(x=>x.slug).sort();
const old=await previousSlugs();

for(const slug of old){
  if(!slugs.includes(slug))await fs.rm(path.join(ROOT,'p',slug),{recursive:true,force:true});
}
for(const page of pages){
  const dir=path.join(ROOT,'p',page.slug);
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'index.html'),renderShell(template,page,{site:SITE}),'utf8');
}
await fs.writeFile(MANIFEST_PATH,JSON.stringify({slugs},null,2)+'\n','utf8');
console.log(`synced ${slugs.length} public/unlisted page metadata shell(s)`);
