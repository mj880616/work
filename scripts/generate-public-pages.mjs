import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=process.cwd();
const TEMPLATE_PATH=path.join(ROOT,'p','index.html');
const MANIFEST_PATH=path.join(ROOT,'p','.generated-pages.json');
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const SITE='https://mj880616.github.io/work';

const escText=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const escAttr=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=v=>String(v??'').replace(/\s+/g,' ').trim();

async function loadPages(){
  const qs=new URLSearchParams({
    status:'eq.published',
    visibility:'eq.public',
    select:'slug,title,summary,updated_at',
    order:'updated_at.desc'
  });
  const r=await fetch(`${SB}/rest/v1/app_pages?${qs}`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});
  if(!r.ok)throw new Error(`public page fetch failed: ${r.status} ${await r.text()}`);
  const rows=await r.json();
  return rows.filter(x=>/^[a-z0-9-]+$/.test(String(x.slug||'')));
}

function metaBlock(page){
  const title=compact(page.title)||'업무 자료';
  const description=(compact(page.summary)||'공공기관사업팀 현장 공유 페이지').slice(0,320);
  const slug=String(page.slug);
  const url=`${SITE}/p/${encodeURIComponent(slug)}/`;
  return `<!-- PUBLIC_PAGE_META_START -->\n<meta name="kptu-page-slug" content="${escAttr(slug)}">\n<meta name="description" content="${escAttr(description)}">\n<meta name="robots" content="index,follow">\n<link rel="canonical" href="${escAttr(url)}">\n<meta property="og:type" content="article">\n<meta property="og:locale" content="ko_KR">\n<meta property="og:site_name" content="공공기관사업팀">\n<meta property="og:title" content="${escAttr(title)}">\n<meta property="og:description" content="${escAttr(description)}">\n<meta property="og:url" content="${escAttr(url)}">\n<meta name="twitter:card" content="summary">\n<meta name="twitter:title" content="${escAttr(title)}">\n<meta name="twitter:description" content="${escAttr(description)}">\n<!-- PUBLIC_PAGE_META_END -->`;
}

function render(template,page){
  const title=compact(page.title)||'업무 자료';
  let html=template
    .replace(/<title>[\s\S]*?<\/title>/i,`<title>${escText(title)} · 업무 현황</title>`)
    .replace(/<!-- PUBLIC_PAGE_META_START -->[\s\S]*?<!-- PUBLIC_PAGE_META_END -->/i,metaBlock(page))
    .replaceAll('href="../favicon.svg"','href="../../favicon.svg"')
    .replaceAll('src="../app/','src="../../app/');
  return html;
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
  await fs.writeFile(path.join(dir,'index.html'),render(template,page),'utf8');
}
await fs.writeFile(MANIFEST_PATH,JSON.stringify({slugs},null,2)+'\n','utf8');
console.log(`synced ${slugs.length} public page metadata shell(s)`);
