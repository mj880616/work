const escText=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const escAttr=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=v=>String(v??'').replace(/\s+/g,' ').trim();

export function buildPagesQuery(){
  return new URLSearchParams({
    status:'eq.published',
    visibility:'in.(public,unlisted)',
    select:'slug,title,summary,updated_at,visibility',
    order:'updated_at.desc'
  });
}

export function metaBlock(page,{site}){
  const title=compact(page.title)||'업무 자료';
  const description=(compact(page.summary)||title).slice(0,320);
  const slug=String(page.slug);
  const url=`${site}/p/${encodeURIComponent(slug)}/`;
  const robots=page.visibility==='unlisted'?'noindex,follow':'index,follow';
  return `<!-- PUBLIC_PAGE_META_START -->\n<meta name="kptu-page-slug" content="${escAttr(slug)}">\n<meta name="description" content="${escAttr(description)}">\n<meta name="robots" content="${robots}">\n<link rel="canonical" href="${escAttr(url)}">\n<meta property="og:type" content="article">\n<meta property="og:locale" content="ko_KR">\n<meta property="og:site_name" content="공공기관사업팀">\n<meta property="og:title" content="${escAttr(title)}">\n<meta property="og:description" content="${escAttr(description)}">\n<meta property="og:url" content="${escAttr(url)}">\n<meta name="twitter:card" content="summary">\n<meta name="twitter:title" content="${escAttr(title)}">\n<meta name="twitter:description" content="${escAttr(description)}">\n<!-- PUBLIC_PAGE_META_END -->`;
}

export function renderShell(template,page,{site}){
  const title=compact(page.title)||'업무 자료';
  return template
    .replace(/<title>[\s\S]*?<\/title>/i,`<title>${escText(title)}</title>`)
    .replace(/<!-- PUBLIC_PAGE_META_START -->[\s\S]*?<!-- PUBLIC_PAGE_META_END -->/i,metaBlock(page,{site}))
    .replaceAll('href="../favicon.svg"','href="../../favicon.svg"')
    .replaceAll('src="../app/','src="../../app/');
}
