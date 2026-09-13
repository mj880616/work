(()=>{
  'use strict';
  if(window.KPTUPageDesign)return;
  const allowed={
    layout:['editorial','dashboard','campaign','briefing'],
    hero:['minimal','band','split'],
    accent:['navy','blue','green','amber','red'],
    section_style:['plain','cards','rules'],
    density:['comfortable','compact']
  };
  const defaults={
    article:{layout:'editorial',hero:'minimal',accent:'navy',section_style:'plain',density:'comfortable'},
    notice:{layout:'briefing',hero:'band',accent:'navy',section_style:'rules',density:'compact'},
    status:{layout:'dashboard',hero:'minimal',accent:'blue',section_style:'cards',density:'compact'},
    event:{layout:'campaign',hero:'band',accent:'red',section_style:'cards',density:'comfortable'},
    brief:{layout:'briefing',hero:'split',accent:'navy',section_style:'rules',density:'comfortable'}
  };
  const labels={
    layout:{editorial:'문서형',dashboard:'대시보드형',campaign:'캠페인형',briefing:'브리핑형'},
    hero:{minimal:'미니멀',band:'강조 배너',split:'분할 헤더'},
    accent:{navy:'네이비',blue:'블루',green:'그린',amber:'앰버',red:'레드'},
    section_style:{plain:'기본',cards:'카드',rules:'구분선'},
    density:{comfortable:'여유',compact:'압축'}
  };
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function normalize(input={},template='article'){
    const base=defaults[template]||defaults.article,src=input&&typeof input==='object'?input:{};
    const out={};
    Object.keys(allowed).forEach(k=>out[k]=allowed[k].includes(src[k])?src[k]:base[k]);
    return out;
  }
  function classNames(input={},template='article'){
    const d=normalize(input,template);
    return `pd-design pd-layout-${d.layout} pd-hero-${d.hero} pd-accent-${d.accent} pd-sections-${d.section_style} pd-density-${d.density}`;
  }
  function describe(input={},template='article'){
    const d=normalize(input,template);
    return `${labels.layout[d.layout]} · ${labels.hero[d.hero]} · ${labels.section_style[d.section_style]} · ${labels.accent[d.accent]} · ${labels.density[d.density]}`;
  }
  function inline(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}
  function renderMarkdown(src=''){
    const lines=String(src||'').split(/\r?\n/);let out='',list=null,section=false;
    const closeList=()=>{if(list){out+=`</${list}>`;list=null}};
    const closeSection=()=>{closeList();if(section){out+='</section>';section=false}};
    for(const raw of lines){
      let m,line=raw||'';
      if((m=line.match(/^##\s+(.+)$/))){closeSection();out+=`<section class="pd-section"><h2>${inline(m[1])}</h2>`;section=true;continue}
      if((m=line.match(/^###\s+(.+)$/))){closeList();out+=`<h3>${inline(m[1])}</h3>`;continue}
      if((m=line.match(/^#\s+(.+)$/))){closeList();out+=`<h2>${inline(m[1])}</h2>`;continue}
      if((m=line.match(/^[-*]\s+(.+)$/))){if(list!=='ul'){closeList();list='ul';out+='<ul>'}out+=`<li>${inline(m[1])}</li>`;continue}
      if((m=line.match(/^\d+[.)]\s+(.+)$/))){if(list!=='ol'){closeList();list='ol';out+='<ol>'}out+=`<li>${inline(m[1])}</li>`;continue}
      closeList();
      if(/^>\s?/.test(line)){out+=`<blockquote>${inline(line.replace(/^>\s?/,''))}</blockquote>`;continue}
      if(!line.trim())continue;
      out+=`<p>${inline(line)}</p>`;
    }
    closeSection();
    return out;
  }
  function ensureStyles(){
    if(document.querySelector('#kptuPageDesignCoreStyle'))return;
    const s=document.createElement('style');s.id='kptuPageDesignCoreStyle';s.textContent=`
      .pd-design{--pd-accent:#17324d;--pd-soft:#eef3f7;--pd-ink:#1d2a36;--pd-muted:#65727e;color:var(--pd-ink)}
      .pd-accent-blue{--pd-accent:#2f6195;--pd-soft:#edf4fb}.pd-accent-green{--pd-accent:#3d7350;--pd-soft:#edf6ef}.pd-accent-amber{--pd-accent:#96651f;--pd-soft:#fff5e4}.pd-accent-red{--pd-accent:#9b3e42;--pd-soft:#fbefef}
      .pd-design .pd-hero{position:relative;padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid #e7ecef}.pd-design .pd-kicker{font-size:10px;font-weight:900;letter-spacing:.12em;color:var(--pd-accent);margin-bottom:8px}.pd-design .pd-title{margin:0;line-height:1.24;letter-spacing:-.75px}.pd-design .pd-summary{color:var(--pd-muted);line-height:1.7;margin:10px 0 0}.pd-design .pd-body{line-height:1.75}.pd-design .pd-body h2{line-height:1.35;margin:0 0 10px}.pd-design .pd-body h3{line-height:1.4;margin:1.1em 0 .45em}.pd-design .pd-body p{margin:.72em 0}.pd-design .pd-body ul,.pd-design .pd-body ol{padding-left:1.35em;margin:.65em 0}.pd-design .pd-body li{margin:.28em 0}.pd-design .pd-body blockquote{margin:1em 0;border-left:4px solid var(--pd-accent);background:var(--pd-soft);padding:10px 13px;border-radius:0 10px 10px 0;color:#4f5d68}
      .pd-hero-band .pd-hero{background:var(--pd-accent);color:#fff;border:0;border-radius:16px;padding:22px 24px;margin-bottom:22px}.pd-hero-band .pd-kicker,.pd-hero-band .pd-summary{color:rgba(255,255,255,.84)}
      .pd-hero-split .pd-hero{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(180px,.55fr);gap:22px;align-items:end;border-bottom:3px solid var(--pd-accent)}.pd-hero-split .pd-summary{margin:0;padding-left:18px;border-left:1px solid #dce4e9}
      .pd-sections-cards .pd-body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pd-sections-cards .pd-body>.pd-section{border:1px solid #e2e8ec;background:#fff;border-radius:13px;padding:15px 16px;min-width:0}.pd-sections-cards .pd-body>:not(.pd-section){grid-column:1/-1}.pd-sections-cards .pd-section h2{color:var(--pd-accent);font-size:1.12em}.pd-sections-rules .pd-section{padding:16px 0;border-top:1px solid #e4e9ed}.pd-sections-rules .pd-section:first-child{border-top:0;padding-top:0}.pd-sections-rules .pd-section h2{color:var(--pd-accent)}
      .pd-layout-dashboard .pd-body{background:#f7f9fa;border-radius:14px;padding:12px}.pd-layout-dashboard.pd-sections-cards .pd-body{background:#f4f7f9}.pd-layout-campaign .pd-title{font-weight:900}.pd-layout-campaign .pd-body h2{color:var(--pd-accent)}.pd-layout-briefing .pd-body strong{color:var(--pd-accent)}
      .pd-density-compact .pd-body{line-height:1.6}.pd-density-compact .pd-body p{margin:.5em 0}.pd-density-compact.pd-sections-cards .pd-body>.pd-section{padding:12px 13px}
      @media(max-width:700px){.pd-hero-split .pd-hero{grid-template-columns:1fr;gap:10px}.pd-hero-split .pd-summary{padding-left:0;border-left:0}.pd-sections-cards .pd-body{grid-template-columns:1fr}.pd-design .pd-hero-band .pd-hero{padding:18px}}
    `;document.head.appendChild(s)
  }
  ensureStyles();
  window.KPTUPageDesign={normalize,classNames,describe,renderMarkdown,ensureStyles,labels};
})();