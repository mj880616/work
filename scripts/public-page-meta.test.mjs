import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPagesQuery,metaBlock,renderShell,renderManagedShell} from './public-page-meta.mjs';

const SITE='https://mj880616.github.io/work';
const page={
  slug:'bus-strike-publicness-internal-archive-202609',
  title:'서울버스 파업·공공성 논쟁 아카이브｜공공교통네트워크 2026.9',
  summary:'제한 공개 테스트 요약',
  visibility:'unlisted',
  metadata:{page_design:{title_size:'small'}}
};

test('published public and unlisted pages are included in metadata generation query',()=>{
  const qs=buildPagesQuery();
  assert.equal(qs.get('status'),'eq.published');
  assert.equal(qs.get('visibility'),'in.(public,unlisted)');
  assert.match(qs.get('select'),/visibility/);
  assert.match(qs.get('select'),/metadata/);
});

test('unlisted page metadata uses the page title and noindex',()=>{
  const html=metaBlock(page,{site:SITE});
  assert.match(html,new RegExp(`<meta property="og:title" content="${page.title}">`));
  assert.match(html,new RegExp(`<meta name="twitter:title" content="${page.title}">`));
  assert.match(html,/<meta name="robots" content="noindex,follow">/);
  assert.match(html,/\/p\/bus-strike-publicness-internal-archive-202609\//);
});

test('public page remains indexable',()=>{
  const html=metaBlock({...page,visibility:'public'},{site:SITE});
  assert.match(html,/<meta name="robots" content="index,follow">/);
});

test('generated shell title is exactly the page title',()=>{
  const template='<!doctype html><html><head><title>업무 자료</title><!-- PUBLIC_PAGE_META_START --><!-- PUBLIC_PAGE_META_END --><link rel="icon" href="../favicon.svg"><script src="../app/a.js"></script></head></html>';
  const html=renderShell(template,page,{site:SITE});
  assert.match(html,new RegExp(`<title>${page.title}</title>`));
  assert.doesNotMatch(html,/· 업무 현황<\/title>/);
});

test('small title design is compact and does not split Korean words',()=>{
  const template='<!doctype html><html><head><title>업무 자료</title><!-- PUBLIC_PAGE_META_START --><!-- PUBLIC_PAGE_META_END --></head><body></body></html>';
  const small=renderShell(template,page,{site:SITE});
  assert.match(small,/data-kptu-page-title-size="small"/);
  assert.match(small,/font-size:29px!important/);
  assert.match(small,/font-size:23px!important/);
  assert.match(small,/word-break:keep-all!important/);

  const normal=renderShell(template,{...page,metadata:{page_design:{}}},{site:SITE});
  assert.doesNotMatch(normal,/data-kptu-page-title-size="small"/);
});

test('managed custom shell keeps its body and scripts while metadata is refreshed',()=>{
  const template='<!doctype html><html><head><title>generic</title><!-- PUBLIC_PAGE_META_START --><!-- PUBLIC_PAGE_META_END --></head><body>generic body</body></html>';
  const existing='<!doctype html><html><head><title>old title</title><!-- PUBLIC_PAGE_META_START --><meta property="og:title" content="old title"><!-- PUBLIC_PAGE_META_END --></head><body><nav id="custom-nav">custom nav</nav><script src="/work/custom.js?v=9"></script></body></html>';
  const next={...page,title:'새 제목',summary:'새 요약'};
  const html=renderManagedShell(template,existing,next,{site:SITE,preserveExisting:true});
  assert.match(html,/id="custom-nav">custom nav/);
  assert.match(html,/src="\/work\/custom\.js\?v=9"/);
  assert.match(html,/<title>새 제목<\/title>/);
  assert.match(html,/<meta property="og:title" content="새 제목">/);
  assert.doesNotMatch(html,/old title/);
});

test('unmanaged shell is regenerated from the generic template',()=>{
  const template='<!doctype html><html><head><title>generic</title><!-- PUBLIC_PAGE_META_START --><!-- PUBLIC_PAGE_META_END --></head><body id="generic-body">generic</body></html>';
  const existing='<!doctype html><html><head><title>old</title><!-- PUBLIC_PAGE_META_START --><!-- PUBLIC_PAGE_META_END --></head><body id="custom-body">custom</body></html>';
  const html=renderManagedShell(template,existing,page,{site:SITE,preserveExisting:false});
  assert.match(html,/id="generic-body">generic/);
  assert.doesNotMatch(html,/custom-body/);
});
