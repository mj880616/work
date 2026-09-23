(()=>{
  'use strict';
  const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
  const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
  const paper=document.querySelector('#paper');
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const error=()=>{paper.innerHTML='<div class="error">공개된 게시글을 찾을 수 없습니다.</div>'};
  const safeUrl=value=>{try{const url=new URL(String(value));return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return''}};
  function renderProject(project){
    const blocks=Array.isArray(project.blocks)?project.blocks:[];
    let previousSection='';
    const body=blocks.map(block=>{
      const c=block.content||{},type=block.type;
      const heading=block.section&&block.section!==previousSection?`<h2 class="public-project-section">${esc(block.section)}</h2>`:'';
      previousSection=block.section||'';
      let content='';
      if(type==='text')content=`<p>${esc(c.text||'')}</p>`;
      else if(type==='table')content=`<div class="public-project-table"><table><thead><tr>${(c.columns||[]).map(v=>`<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${(c.rows||[]).map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      else if(type==='timeline')content=`<ul>${(c.items||[]).map(x=>`<li><b>${esc(x.date)}</b> ${esc(x.title)}${x.body?` · ${esc(x.body)}`:''}</li>`).join('')}</ul>`;
      else if(type==='links')content=`<ul>${(c.items||[]).map(x=>{const url=safeUrl(x.url);return `<li>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(x.label||url)}</a>`:esc(x.label||'링크')}${x.note?` · ${esc(x.note)}`:''}</li>`}).join('')}</ul>`;
      else if(type==='status'||type==='metrics')content=`<dl>${(c.items||[]).map(x=>`<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}${x.note?` · ${esc(x.note)}`:''}</dd></div>`).join('')}</dl>`;
      return heading+`<section class="public-project-block"><h3>${esc(block.title||'')}</h3>${content}</section>`;
    }).join('');
    paper.className='paper public-project';
    paper.innerHTML=`<header><h1>${esc(project.title)}</h1>${project.summary?`<p class="public-project-summary">${esc(project.summary)}</p>`:''}</header><div class="public-project-content">${body}</div>`;
    document.title=project.title;
  }
  document.querySelector('#printPageBtn')?.addEventListener('click',()=>window.print());

  async function load(){
    const slug=document.querySelector('meta[name="kptu-page-slug"]')?.content?.trim()||new URLSearchParams(location.search).get('slug');
    if(!slug||!(/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)))return error();
    const projectSlug=/^project-[0-9a-f]{32}$/.test(slug);
    if(projectSlug)return error();
    const response=await fetch(SB+'/rest/v1/rpc/app_public_post',{
      method:'POST',cache:'no-store',
      headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},
      body:JSON.stringify({p_slug:slug})
    });
    if(!response.ok)return error();
    const rows=await response.json();
    const post=Array.isArray(rows)?rows[0]:null;
    if(!post)return error();
    const design=post.page_design||{};
    const template=design.template||'article';
    const renderer=window.KPTUPageDesign;
    paper.className='paper '+(renderer?.classNames(design,template)||'pd-design');
    const documentUrl=String(post.document_url||'');
    const publicDocument=/^https:\/\//i.test(documentUrl);
    paper.innerHTML=`<header class="pd-hero"><h1 class="pd-title">${esc(post.title)}</h1>${post.summary?`<p class="pd-summary">${esc(post.summary)}</p>`:''}</header><div class="pd-body">${renderer?.renderMarkdown(post.body||'')||esc(post.body||'')}${publicDocument?`<p><a href="${esc(documentUrl)}" target="_blank" rel="noopener">자료 열기</a></p>`:''}</div>`;
    document.title=post.title;
  }
  load().catch(error);
})();
