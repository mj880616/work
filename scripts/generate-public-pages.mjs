import fs from 'node:fs/promises';
import path from 'node:path';
import {renderManagedShell} from './public-page-meta.mjs';

const ROOT=process.cwd();
const TEMPLATE_PATH=path.join(ROOT,'p','index.html');
const CUSTOM_MANIFEST_PATH=path.join(ROOT,'p','.custom-page-shells.json');
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const SITE='https://mj880616.github.io/work';

// Only the six reviewed legacy URLs have dedicated shells. New public posts
// use /p/?slug=... and never require an anonymous list endpoint.
const custom=JSON.parse(await fs.readFile(CUSTOM_MANIFEST_PATH,'utf8')).slugs;
if(!Array.isArray(custom)||custom.length!==6||new Set(custom).size!==6||
   custom.some(slug=>!(/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)))){
  throw new Error('Invalid reviewed custom public page manifest');
}
const template=await fs.readFile(TEMPLATE_PATH,'utf8');
if(!template.includes('PUBLIC_PAGE_META_START'))throw new Error('Missing metadata template markers');

for(const slug of custom){
  const response=await fetch(SB+'/rest/v1/rpc/app_public_post',{
    method:'POST',cache:'no-store',
    headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},
    body:JSON.stringify({p_slug:slug})
  });
  if(!response.ok)throw new Error('Public post lookup failed for '+slug+': '+response.status);
  const rows=await response.json();
  const post=Array.isArray(rows)?rows[0]:null;
  const page=post
    ?{slug,title:post.title,summary:post.summary,visibility:post.indexable===false?'unlisted':'public',metadata:{page_design:post.page_design||{}}}
    :{slug,title:'공유 게시글',summary:'',visibility:'private',metadata:{}};
  const file=path.join(ROOT,'p',slug,'index.html');
  const existing=await fs.readFile(file,'utf8');
  const html=renderManagedShell(template,existing,page,{site:SITE,preserveExisting:true});
  if(html!==existing)await fs.writeFile(file,html,'utf8');
}
console.log('synced metadata for '+custom.length+' reviewed public URLs');
