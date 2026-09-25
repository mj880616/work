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
// `slugs` are live pages; `withdrawn` pages were taken down through a reviewed
// PR and always get neutral metadata, whatever the RPC returns.
const SLUG_RE=/^[a-z0-9][a-z0-9-]{0,99}$/;
const manifest=JSON.parse(await fs.readFile(CUSTOM_MANIFEST_PATH,'utf8'));
const active=manifest.slugs;
const withdrawn=manifest.withdrawn;
if(!Array.isArray(active)||!Array.isArray(withdrawn)){
  throw new Error('Invalid reviewed custom public page manifest');
}
const custom=[...active,...withdrawn];
if(custom.length!==6||new Set(custom).size!==6||custom.some(slug=>!SLUG_RE.test(slug))){
  throw new Error('Invalid reviewed custom public page manifest');
}
const template=await fs.readFile(TEMPLATE_PATH,'utf8');
if(!template.includes('<!-- PUBLIC_PAGE_META_START -->')||!template.includes('<!-- PUBLIC_PAGE_META_END -->')){
  throw new Error('Missing metadata template markers');
}

const neutral=slug=>({slug,title:'공유 게시글',summary:'',visibility:'private',metadata:{}});

// Look up every live page before writing anything, so a later failure cannot
// leave earlier shells half-updated.
let awaitingPrepare=false;
const pages=[];
const empty=[];
for(const slug of active){
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
  if(!post){
    // An empty lookup is never treated as a takedown; that needs `withdrawn`.
    empty.push(slug);
    continue;
  }
  pages.push({slug,title:post.title,summary:post.summary,visibility:post.indexable===false?'unlisted':'public',metadata:{page_design:post.page_design||{}}});
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
  for(const page of [...pages,...withdrawn.map(neutral)]){
    const file=path.join(ROOT,'p',page.slug,'index.html');
    const existing=await fs.readFile(file,'utf8');
    const html=renderManagedShell(template,existing,page,{site:SITE,preserveExisting:true});
    if(html!==existing)await fs.writeFile(file,html,'utf8');
  }
  for(const slug of empty){
    console.error('public post lookup returned no row for live page '+slug+
      '; kept existing metadata. Restore the page, or list it under "withdrawn" in p/.custom-page-shells.json.');
  }
  console.log('synced metadata for '+pages.length+' live and '+withdrawn.length+' withdrawn reviewed public URLs');
  if(empty.length)process.exitCode=1;
}
