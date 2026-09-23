import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {metaBlock,renderShell,renderManagedShell} from './public-page-meta.mjs';

const SITE='https://mj880616.github.io/work';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const page={
  slug:'bus-strike-publicness-internal-archive-202609',
  title:'서울버스 파업·공공성 논쟁 아카이브｜공공교통네트워크 2026.9',
  summary:'제한 공개 테스트 요약',
  visibility:'unlisted',
  metadata:{page_design:{title_size:'small'}}
};

test('real generic template has managed metadata markers and stays noindex',()=>{
  const template=readFileSync(path.join(ROOT,'p','index.html'),'utf8');
  assert.match(template,/<!-- PUBLIC_PAGE_META_START -->[\s\S]*<!-- PUBLIC_PAGE_META_END -->/);
  assert.match(template,/<meta name="robots" content="noindex,nofollow">/);
  const shell=renderShell(template,{...page,visibility:'public'},{site:SITE});
  assert.match(shell,/<meta name="kptu-page-slug" content="bus-strike-publicness-internal-archive-202609">/);
  assert.match(shell,/<meta name="description" content="제한 공개 테스트 요약">/);
  assert.match(shell,/<meta name="robots" content="index,follow">/);
  assert.match(shell,/<link rel="canonical" href="https:\/\/mj880616.github.io\/work\/p\/bus-strike-publicness-internal-archive-202609\/">/);
  assert.match(shell,/<meta property="og:title"/);
  assert.match(shell,/<meta name="twitter:title"/);
  assert.match(shell,/src="\.\.\/public-post\.js\?v=3"/);
});

function runGeneratorWithSyntheticFetch(status=200){
  const dir=mkdtempSync(path.join(tmpdir(),'web2-public-meta-'));
  try{
    mkdirSync(path.join(dir,'p'),{recursive:true});
    cpSync(path.join(ROOT,'p','index.html'),path.join(dir,'p','index.html'));
    cpSync(path.join(ROOT,'p','.custom-page-shells.json'),path.join(dir,'p','.custom-page-shells.json'));
    const slugs=JSON.parse(readFileSync(path.join(ROOT,'p','.custom-page-shells.json'),'utf8')).slugs;
    for(const slug of slugs){
      mkdirSync(path.join(dir,'p',slug),{recursive:true});
      cpSync(path.join(ROOT,'p',slug,'index.html'),path.join(dir,'p',slug,'index.html'));
    }
    const before=slugs.map(slug=>readFileSync(path.join(dir,'p',slug,'index.html'),'utf8'));
    const source=`globalThis.fetch=async(_url,options)=>{const slug=JSON.parse(options.body).p_slug;return new Response(${status}===200?JSON.stringify([{title:'합성 '+slug,summary:'합성 요약',indexable:false,page_design:{}}]):JSON.stringify({code:'PGRST202'}),{status:${status},headers:{'Content-Type':'application/json'}})};await import(${JSON.stringify(new URL('./generate-public-pages.mjs',import.meta.url).href)});`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:dir,encoding:'utf8'});
    const after=slugs.map(slug=>readFileSync(path.join(dir,'p',slug,'index.html'),'utf8'));
    return {result,slugs,before,after};
  }finally{rmSync(dir,{recursive:true,force:true})}
}

test('actual generator refreshes six legacy shells from synthetic public rows',()=>{
  const {result,slugs,after}=runGeneratorWithSyntheticFetch();
  assert.equal(result.status,0,result.stderr);
  for(const [index,slug] of slugs.entries()){
    assert.match(after[index],new RegExp(`<meta name="kptu-page-slug" content="${slug}">`));
    assert.match(after[index],new RegExp(`<title>합성 ${slug}</title>`));
    assert.match(after[index],/<meta name="robots" content="noindex,nofollow">/);
  }
});

test('pre-migration missing RPC preserves all six existing public shells',()=>{
  const {result,before,after}=runGeneratorWithSyntheticFetch(404);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(after,before);
});

test('metadata generation still fails on server errors',()=>{
  const {result,before,after}=runGeneratorWithSyntheticFetch(503);
  assert.notEqual(result.status,0);
  assert.deepEqual(after,before);
});

async function requestedSlug(metaSlug,querySlug){
  const calls=[];
  const paper={innerHTML:''};
  const source=readFileSync(path.join(ROOT,'p','public-post.js'),'utf8');
  runInNewContext(source,{
    document:{querySelector:selector=>selector==='#paper'?paper:selector==='meta[name="kptu-page-slug"]'&&metaSlug?{content:metaSlug}:null},
    location:{search:`?slug=${querySlug}`},
    URLSearchParams,
    fetch:async(_url,options)=>{calls.push(JSON.parse(options.body).p_slug);return {ok:true,json:async()=>[]}},
    window:{}
  });
  await new Promise(resolve=>setImmediate(resolve));
  return calls;
}

test('fixed shell slug wins over query slug, while generic shell uses the query',async()=>{
  assert.deepEqual(await requestedSlug('gimpo-publicization','other-public'),['gimpo-publicization']);
  assert.deepEqual(await requestedSlug('', 'generic-public'),['generic-public']);
});

test('nonpublic page metadata is excluded from indexing',()=>{
  const html=metaBlock(page,{site:SITE});
  assert.match(html,new RegExp(`<meta property="og:title" content="${page.title}">`));
  assert.match(html,new RegExp(`<meta name="twitter:title" content="${page.title}">`));
  assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
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

test('managed custom shell keeps legacy body and scripts while metadata is refreshed',()=>{
  const template='<!doctype html><html><head><title>generic</title><!-- PUBLIC_PAGE_META_START --><!-- PUBLIC_PAGE_META_END --></head><body>generic body<script src="../app/public-page-editor.js?v=5"></script></body></html>';
  const existing='<!doctype html><html><head><title>old title</title><meta name="description" content="old summary"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="https://old.example/"><meta property="og:title" content="old title"><meta property="og:description" content="old summary"><meta property="og:url" content="https://old.example/"></head><body><nav id="custom-nav">custom nav</nav><script src="/work/custom.js?v=9"></script><script src="../../app/public-page-editor.js?v=4"></script></body></html>';
  const next={...page,title:'새 제목',summary:'새 요약'};
  const html=renderManagedShell(template,existing,next,{site:SITE,preserveExisting:true});
  assert.match(html,/id="custom-nav">custom nav/);
  assert.match(html,/src="\/work\/custom\.js\?v=9"/);
  assert.match(html,/src="\.\.\/\.\.\/app\/public-page-editor\.js\?v=5"/);
  assert.doesNotMatch(html,/public-page-editor\.js\?v=4/);
  assert.match(html,/<title>새 제목<\/title>/);
  assert.match(html,/PUBLIC_PAGE_META_START/);
  assert.match(html,/<meta property="og:title" content="새 제목">/);
  assert.match(html,/<meta property="og:description" content="새 요약">/);
  assert.doesNotMatch(html,/old title|old summary|old\.example/);
});

test('unmanaged shell is regenerated from the generic template',()=>{
  const template='<!doctype html><html><head><title>generic</title><!-- PUBLIC_PAGE_META_START --><!-- PUBLIC_PAGE_META_END --></head><body id="generic-body">generic</body></html>';
  const existing='<!doctype html><html><head><title>old</title></head><body id="custom-body">custom</body></html>';
  const html=renderManagedShell(template,existing,page,{site:SITE,preserveExisting:false});
  assert.match(html,/id="generic-body">generic/);
  assert.doesNotMatch(html,/custom-body/);
});
