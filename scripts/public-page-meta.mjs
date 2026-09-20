const escText=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const escAttr=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=v=>String(v??'').replace(/\s+/g,' ').trim();
const TITLE_SIZE_STYLE_RE=/<style data-kptu-page-title-size="small">[\s\S]*?<\/style>/gi;
const META_BLOCK_RE=/<!-- PUBLIC_PAGE_META_START -->[\s\S]*?<!-- PUBLIC_PAGE_META_END -->/i;
const MANAGED_NAME_META_RE=/<meta\s+name=["'](?:kptu-page-slug|description|robots|twitter:card|twitter:title|twitter:description)["'][^>]*>\s*/gi;
const MANAGED_OG_META_RE=/<meta\s+property=["'](?:og:type|og:locale|og:site_name|og:title|og:description|og:url)["'][^>]*>\s*/gi;
const MANAGED_CANONICAL_RE=/<link\s+rel=["']canonical["'][^>]*>\s*/gi;
const EDITOR_VERSION_RE=/public-page-editor\.js\?v=([^"'&<>\s]+)/i;
const EDITOR_VERSION_RE_GLOBAL=/(public-page-editor\.js\?v=)[^"'&<>\s]+/gi;

export function metaBlock(page,{site}){
  const title=compact(page.title)||'업무 자료';
  const description=(compact(page.summary)||title).slice(0,320);
  const slug=String(page.slug);
  const url=`${site}/p/${encodeURIComponent(slug)}/`;
  const robots=page.visibility==='public'?'index,follow':'noindex,nofollow';
  return `<!-- PUBLIC_PAGE_META_START -->\n<meta name="kptu-page-slug" content="${escAttr(slug)}">\n<meta name="description" content="${escAttr(description)}">\n<meta name="robots" content="${robots}">\n<link rel="canonical" href="${escAttr(url)}">\n<meta property="og:type" content="article">\n<meta property="og:locale" content="ko_KR">\n<meta property="og:site_name" content="공공기관사업팀">\n<meta property="og:title" content="${escAttr(title)}">\n<meta property="og:description" content="${escAttr(description)}">\n<meta property="og:url" content="${escAttr(url)}">\n<meta name="twitter:card" content="summary">\n<meta name="twitter:title" content="${escAttr(title)}">\n<meta name="twitter:description" content="${escAttr(description)}">\n<!-- PUBLIC_PAGE_META_END -->`;
}

function titleSizeStyle(page){
  if(page?.metadata?.page_design?.title_size!=='small')return '';
  return '<style data-kptu-page-title-size="small">.paper .pd-title{font-size:29px!important;word-break:keep-all!important}@media(max-width:650px){.paper .pd-title{font-size:23px!important}}</style>';
}

function applyTitleSizeStyle(html,page){
  let next=String(html||'').replace(TITLE_SIZE_STYLE_RE,'');
  const style=titleSizeStyle(page);
  if(style)next=next.replace(/<\/head>/i,`${style}</head>`);
  return next;
}

function stripLegacyManagedMeta(html){
  return String(html||'')
    .replace(MANAGED_NAME_META_RE,'')
    .replace(MANAGED_OG_META_RE,'')
    .replace(MANAGED_CANONICAL_RE,'');
}

function templateEditorVersion(template){
  return String(template||'').match(EDITOR_VERSION_RE)?.[1]||'';
}

function applyEditorVersion(html,version){
  if(!version)return String(html||'');
  return String(html||'').replace(EDITOR_VERSION_RE_GLOBAL,`$1${version}`);
}

function refreshMetadata(html,page,{site,editorVersion=''}){
  const title=compact(page.title)||'업무 자료';
  let next=String(html||'').replace(/<title>[\s\S]*?<\/title>/i,`<title>${escText(title)}</title>`);
  if(META_BLOCK_RE.test(next)){
    next=next.replace(META_BLOCK_RE,metaBlock(page,{site}));
  }else{
    next=stripLegacyManagedMeta(next);
    if(!/<title>[\s\S]*?<\/title>/i.test(next))throw new Error(`custom public page shell for ${page.slug} is missing a title element`);
    next=next.replace(/<\/title>/i,`</title>\n${metaBlock(page,{site})}`);
  }
  next=applyEditorVersion(next,editorVersion);
  return applyTitleSizeStyle(next,page);
}

export function renderShell(template,page,{site}){
  const title=compact(page.title)||'업무 자료';
  let html=template
    .replace(/<title>[\s\S]*?<\/title>/i,`<title>${escText(title)}</title>`)
    .replace(META_BLOCK_RE,metaBlock(page,{site}))
    .replaceAll('href="../favicon.svg"','href="../../favicon.svg"')
    .replaceAll('src="../app/','src="../../app/')
    .replaceAll('src="./public-post.js','src="../public-post.js');
  return applyTitleSizeStyle(html,page);
}

export function renderManagedShell(template,existing,page,{site,preserveExisting=false}={}){
  if(preserveExisting){
    if(!existing)throw new Error(`custom public page shell for ${page.slug} does not exist`);
    return refreshMetadata(existing,page,{site,editorVersion:templateEditorVersion(template)});
  }
  return renderShell(template,page,{site});
}
