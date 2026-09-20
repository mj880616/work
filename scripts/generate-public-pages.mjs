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
if(!template.includes('<!-- PUBLIC_PAGE_META_START -->')||!template.includes('<!-- PUBLIC_PAGE_META_END -->')){
  throw new Error('Missing metadata template markers');
}

let awaitingPrepare=false;
for(const slug of custom){
  const response=await fetch(SB+'/rest/v1/rpc/app_public_post',{
    method:'POST',cache:'no-store',
    headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},
    body:JSON.stringify({p_slug:slug})
  });
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    if(response.status===404&&problem?.code==='PGRST202'){
      awaitingPrepare=true;
      break;
    }
    throw new Error('Public post lookup failed for '+slug+': '+response.status);
  }
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
if(awaitingPrepare){
  // Before the additive prepare migration, preserve reviewed shells instead of
  // querying the broad anonymous page list or replacing live metadata.
  for(const slug of custom){
    const existing=await fs.readFile(path.join(ROOT,'p',slug,'index.html'),'utf8');
    if(!existing.includes(`<!-- PUBLIC_PAGE_META_START -->`)||
       !existing.includes(`<meta name="kptu-page-slug" content="${slug}">`)){
      throw new Error('Existing public shell metadata is incomplete for '+slug);
    }
  }
  console.log('public post RPC not deployed yet; preserved six reviewed metadata shells');
}else{
  console.log('synced metadata for '+custom.length+' reviewed public URLs');
}
