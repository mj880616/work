(()=>{
  'use strict';
  if(window.KPTUPageDesign)return;

  const allowed={
    layout:['editorial','dashboard','campaign','briefing','checklist'],
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
    brief:{layout:'briefing',hero:'split',accent:'navy',section_style:'rules',density:'comfortable'},
    checklist:{layout:'checklist',hero:'band',accent:'navy',section_style:'cards',density:'comfortable'}
  };

  const labels={
    layout:{editorial:'문서형',dashboard:'대시보드형',campaign:'캠페인형',briefing:'브리핑형',checklist:'체크리스트형'},
    hero:{minimal:'미니멀',band:'강조 배너',split:'분할 헤더'},
    accent:{navy:'네이비',blue:'블루',green:'그린',amber:'앰버',red:'레드'},
    section_style:{plain:'기본',cards:'카드',rules:'구분선'},
    density:{comfortable:'여유',compact:'압축'}
  };

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function normalize(input={},template='article'){
    const base=defaults[template]||defaults.article;
    const src=input&&typeof input==='object'?input:{};
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

  function inline(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');}

  function forumFlow(){
    return `<div class="pd-forum-flow" aria-label="민자철도 토론회 기본 구조">
      <div class="pd-flow-top">
        <div class="pd-flow-node pd-flow-red">수익 ↑ · 비용절감 압력</div><span class="pd-flow-arrow">→</span>
        <div class="pd-flow-node pd-flow-redsoft">낮은 처우·인력 축소</div><span class="pd-flow-arrow">→</span>
        <div class="pd-flow-node pd-flow-amber">이직·결원</div><span class="pd-flow-arrow">→</span>
        <div class="pd-flow-node pd-flow-amber">정원 부족</div><span class="pd-flow-arrow">→</span>
        <div class="pd-flow-node pd-flow-yellow">과로·휴일근무·1인근무</div><span class="pd-flow-arrow">→</span>
        <div class="pd-flow-node pd-flow-danger">노동자 건강 위험<br>시민 안전 위험</div>
      </div>
      <div class="pd-flow-branch">
        <div class="pd-flow-track pd-flow-blue">
          <div class="pd-flow-problem">현 제도의 위험 인식·포착 실패<div class="pd-flow-note">철도안전관리체계가 실제 노동과정의 위험을 제대로 인식·포착하지 못함에 따라 철도안전을 제대로 관리하지 못하고 있음</div></div>
          <div class="pd-flow-down">↓</div>
          <div class="pd-flow-solution">철도안전관리체계 실질화</div>
        </div>
        <div class="pd-flow-track pd-flow-green">
          <div class="pd-flow-problem">정부(국토교통부)의 관리·감독 부재<div class="pd-flow-note">운영계약이 영업비밀이라는 이유로 공개조차 되지 않음<br>민간투자사업이라는 이유로 최소한의 안전·권리 감독을 위한 기준 부재</div></div>
          <div class="pd-flow-down">↓</div>
          <div class="pd-flow-solution">민자철도 운영기준·운영평가에<br>안전인력·처우·휴식 기준 반영</div>
        </div>
      </div>
      <div class="pd-flow-merge"><span>↘</span><span>↙</span></div>
      <div class="pd-flow-goal">지금보다 더 안전한 철도</div>
    </div>`;
  }

  function renderMarkdown(src=''){
    const lines=String(src||'').split(/\r?\n/);
    let out='',list=null,section=false,details=false;
    const closeList=()=>{if(list){out+=`</${list}>`;list=null;}};
    const closeDetails=()=>{closeList();if(details){out+='</div></details>';details=false;}};
    const closeSection=()=>{closeDetails();if(section){out+='</section>';section=false;}};

    for(const raw of lines){
      let m,line=raw||'';
      if(/^:::forum-flow\s*$/.test(line)){closeList();out+=forumFlow();continue;}
      if((m=line.match(/^##\s+(.+)$/))){closeSection();out+=`<section class="pd-section"><h2>${inline(m[1])}</h2>`;section=true;continue;}
      if((m=line.match(/^:::details\s+(.+)$/))){closeDetails();out+=`<details class="pd-details"><summary>${inline(m[1])}</summary><div class="pd-details-body">`;details=true;continue;}
      if(/^:::\s*$/.test(line)){closeDetails();continue;}
      if((m=line.match(/^####\s+(.+)$/))){closeList();out+=`<h4>${inline(m[1])}</h4>`;continue;}
      if((m=line.match(/^###\s+(.+)$/))){closeList();out+=`<h3>${inline(m[1])}</h3>`;continue;}
      if((m=line.match(/^#\s+(.+)$/))){closeList();out+=`<h2>${inline(m[1])}</h2>`;continue;}
      if((m=line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/))){if(list!=='ul'){closeList();list='ul';out+='<ul class="pd-checklist">';}const done=m[1].toLowerCase()==='x';out+=`<li class="pd-check ${done?'pd-check-done':'pd-check-open'}"><span class="pd-checkbox" aria-hidden="true">${done?'✓':''}</span><span>${inline(m[2])}</span></li>`;continue;}
      if((m=line.match(/^[-*]\s+(.+)$/))){if(list!=='ul'){closeList();list='ul';out+='<ul>';}out+=`<li>${inline(m[1])}</li>`;continue;}
      if((m=line.match(/^\d+[.)]\s+(.+)$/))){if(list!=='ol'){closeList();list='ol';out+='<ol>';}out+=`<li>${inline(m[1])}</li>`;continue;}
      closeList();
      if(/^>\s?/.test(line)){out+=`<blockquote>${inline(line.replace(/^>\s?/,''))}</blockquote>`;continue;}
      if(!line.trim())continue;
      out+=`<p>${inline(line)}</p>`;
    }
    closeSection();
    return out;
  }

  function ensureStyles(){
    if(document.querySelector('#kptuPageDesignCoreStyle'))return;
    const s=document.createElement('style');
    s.id='kptuPageDesignCoreStyle';
    s.textContent=`
      .pd-design{--pd-accent:#17324d;--pd-soft:#eef3f7;--pd-ink:#1d2a36;--pd-muted:#65727e;color:var(--pd-ink)}
      .pd-accent-blue{--pd-accent:#2f6195;--pd-soft:#edf4fb}.pd-accent-green{--pd-accent:#3d7350;--pd-soft:#edf6ef}.pd-accent-amber{--pd-accent:#96651f;--pd-soft:#fff5e4}.pd-accent-red{--pd-accent:#9b3e42;--pd-soft:#fbefef}
      .pd-design .pd-hero{position:relative;padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid #e7ecef}.pd-design .pd-kicker{font-size:10px;font-weight:900;letter-spacing:.12em;color:var(--pd-accent);margin-bottom:8px}.pd-design .pd-title{margin:0;line-height:1.24;letter-spacing:-.75px}.pd-design .pd-summary{color:var(--pd-muted);line-height:1.7;margin:10px 0 0}.pd-design .pd-body{line-height:1.75}.pd-design .pd-body h2{line-height:1.35;margin:0 0 10px}.pd-design .pd-body h3{line-height:1.4;margin:1.1em 0 .45em}.pd-design .pd-body h4{line-height:1.45;margin:1em 0 .35em}.pd-design .pd-body p{margin:.72em 0}.pd-design .pd-body ul,.pd-design .pd-body ol{padding-left:1.35em;margin:.65em 0}.pd-design .pd-body li{margin:.28em 0}.pd-design .pd-body blockquote{margin:1em 0;border-left:4px solid var(--pd-accent);background:var(--pd-soft);padding:10px 13px;border-radius:0 10px 10px 0;color:#4f5d68}
      .pd-hero-band .pd-hero{background:var(--pd-accent);color:#fff;border:0;border-radius:16px;padding:22px 24px;margin-bottom:22px}.pd-hero-band .pd-kicker,.pd-hero-band .pd-summary{color:rgba(255,255,255,.84)}
      .pd-hero-split .pd-hero{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(180px,.55fr);gap:22px;align-items:end;border-bottom:3px solid var(--pd-accent)}.pd-hero-split .pd-summary{margin:0;padding-left:18px;border-left:1px solid #dce4e9}
      .pd-sections-cards .pd-body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pd-sections-cards .pd-body>.pd-section{border:1px solid #e2e8ec;background:#fff;border-radius:13px;padding:15px 16px;min-width:0}.pd-sections-cards .pd-body>:not(.pd-section){grid-column:1/-1}.pd-sections-cards .pd-section h2{color:var(--pd-accent);font-size:1.12em}.pd-sections-rules .pd-section{padding:16px 0;border-top:1px solid #e4e9ed}.pd-sections-rules .pd-section:first-child{border-top:0;padding-top:0}.pd-sections-rules .pd-section h2{color:var(--pd-accent)}
      .pd-layout-dashboard .pd-body{background:#f7f9fa;border-radius:14px;padding:12px}.pd-layout-dashboard.pd-sections-cards .pd-body{background:#f4f7f9}.pd-layout-campaign .pd-title{font-weight:900}.pd-layout-campaign .pd-body h2{color:var(--pd-accent)}.pd-layout-briefing .pd-body strong{color:var(--pd-accent)}
      .pd-density-compact .pd-body{line-height:1.6}.pd-density-compact .pd-body p{margin:.5em 0}.pd-density-compact.pd-sections-cards .pd-body>.pd-section{padding:12px 13px}
      .pd-layout-checklist{background:#f7f9fb}.pd-layout-checklist .pd-hero{border-radius:20px;padding:28px 30px;box-shadow:0 12px 28px rgba(23,50,77,.14)}.pd-layout-checklist .pd-title{font-weight:950;font-size:34px}.pd-layout-checklist .pd-summary{max-width:850px;font-size:14px}.pd-layout-checklist .pd-content{background:#f7f9fb}.pd-layout-checklist .pd-body{display:block!important;background:transparent!important;padding:0!important}.pd-layout-checklist .pd-body>.pd-section{margin:0 0 14px!important;border:1px solid #e0e6eb!important;background:#fff!important;border-radius:16px!important;padding:18px 20px!important;box-shadow:0 5px 16px rgba(23,50,77,.045)}.pd-layout-checklist .pd-body>.pd-section:first-child{background:var(--pd-soft)!important;border-color:#d4e0e9!important}.pd-layout-checklist .pd-section h2{display:flex;align-items:center;gap:8px;margin:0 0 11px!important;color:var(--pd-accent)!important;font-size:18px!important;font-weight:900}.pd-layout-checklist .pd-section p{color:#53616e}.pd-layout-checklist .pd-checklist{list-style:none!important;padding:0!important;margin:10px 0 0!important;display:grid;gap:8px}.pd-layout-checklist .pd-check{display:flex;align-items:flex-start;gap:10px;margin:0!important;padding:10px 12px;border:1px solid #e6ebef;border-radius:11px;background:#fbfcfd;line-height:1.55}.pd-layout-checklist .pd-checkbox{flex:0 0 18px;width:18px;height:18px;margin-top:2px;border:1.5px solid #9fb0bd;border-radius:5px;background:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff}.pd-layout-checklist .pd-check-done{background:#f4faf6;border-color:#cfe2d5;color:#53655a}.pd-layout-checklist .pd-check-done .pd-checkbox{background:#3d7350;border-color:#3d7350}.pd-layout-checklist .pd-body strong{color:var(--pd-accent)}.pd-layout-checklist .piv-aside{background:#fff;border:1px solid #e4e9ed;border-radius:13px;padding:15px!important}
      .pd-layout-checklist .pd-details{margin:10px 0;border:1px solid #dde5eb;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 2px 8px rgba(23,50,77,.035)}.pd-layout-checklist .pd-details summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;font-weight:900;color:var(--pd-accent);user-select:none}.pd-layout-checklist .pd-details summary::-webkit-details-marker{display:none}.pd-layout-checklist .pd-details summary::after{content:'＋';flex:0 0 auto;font-size:18px;line-height:1;color:#7a8995}.pd-layout-checklist .pd-details[open] summary{background:#fbfcfd;border-bottom:1px solid #e5ebef}.pd-layout-checklist .pd-details[open] summary::after{content:'−'}.pd-layout-checklist .pd-details-body{padding:5px 16px 16px}.pd-layout-checklist .pd-details-body h4{font-size:15px;color:var(--pd-accent);font-weight:900;margin:16px 0 6px}.pd-layout-checklist .pd-details-body p{color:#53616e}
      .pd-forum-flow{margin:8px 0 2px;padding:16px;border-radius:16px;background:#fff;border:1px solid #dbe4ea}.pd-flow-top{display:flex;align-items:stretch;justify-content:center;gap:6px}.pd-flow-node{display:flex;align-items:center;justify-content:center;text-align:center;min-height:62px;flex:1;padding:9px 7px;border-radius:13px;font-weight:850;line-height:1.3;border:1px solid transparent;min-width:0}.pd-flow-arrow{display:flex;align-items:center;font-size:20px;font-weight:900;color:#718495}.pd-flow-red{background:#f9dedc;border-color:#efc5c2;color:#8d292c}.pd-flow-redsoft{background:#fae6df;border-color:#efd0c5;color:#8a3e2d}.pd-flow-amber{background:#fbe9cf;border-color:#efd6af;color:#805326}.pd-flow-yellow{background:#fff2c9;border-color:#eddc9c;color:#765c16}.pd-flow-danger{background:#f6dddd;border-color:#e8bebe;color:#8e2f34}.pd-flow-branch{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px;position:relative}.pd-flow-branch:before{content:'';position:absolute;left:25%;right:25%;top:-13px;border-top:2px solid #8ba0b0}.pd-flow-track{border-radius:15px;padding:0;border:1px solid;overflow:hidden}.pd-flow-problem,.pd-flow-solution{padding:15px 14px;text-align:center;font-weight:850;line-height:1.45}.pd-flow-note{margin-top:7px;font-size:12.5px;line-height:1.55;font-weight:600;opacity:.82}.pd-flow-down{text-align:center;font-size:23px;font-weight:900;padding:2px 0}.pd-flow-blue{border-color:#b9d5ee;background:#eef6fc;color:#1d5685}.pd-flow-blue .pd-flow-solution{background:#dfeefa}.pd-flow-green{border-color:#b9dfc3;background:#eef8f0;color:#276944}.pd-flow-green .pd-flow-solution{background:#dff1e4}.pd-flow-merge{display:flex;justify-content:space-around;max-width:420px;margin:5px auto -3px;font-size:30px;font-weight:900;color:#4c7284}.pd-flow-goal{max-width:570px;margin:0 auto;background:#176744;color:#fff;border-radius:15px;padding:16px 18px;text-align:center;font-size:22px;font-weight:950;letter-spacing:-.3px;box-shadow:0 6px 14px rgba(23,103,68,.14)}
      @media(max-width:700px){.pd-hero-split .pd-hero{grid-template-columns:1fr;gap:10px}.pd-hero-split .pd-summary{padding-left:0;border-left:0}.pd-sections-cards .pd-body{grid-template-columns:1fr}.pd-design .pd-hero-band .pd-hero{padding:18px}.pd-layout-checklist .pd-hero{padding:22px 19px!important;border-radius:17px}.pd-layout-checklist .pd-title{font-size:27px}.pd-layout-checklist .pd-body>.pd-section{padding:15px 14px!important;border-radius:14px!important}.pd-layout-checklist .pd-check{padding:9px 10px}.pd-layout-checklist .pd-details summary{padding:13px 14px}.pd-layout-checklist .pd-details-body{padding:4px 14px 14px}.pd-forum-flow{padding:12px}.pd-flow-top{flex-direction:column;gap:5px}.pd-flow-node{min-height:0;width:auto;padding:10px 12px}.pd-flow-arrow{justify-content:center;transform:rotate(90deg);height:18px}.pd-flow-branch{grid-template-columns:1fr;gap:11px;margin-top:18px}.pd-flow-branch:before{display:none}.pd-flow-merge{display:none}.pd-flow-goal{margin-top:12px;font-size:19px;padding:14px}}
    `;
    document.head.appendChild(s);
  }

  ensureStyles();
  window.KPTUPageDesign={normalize,classNames,describe,renderMarkdown,ensureStyles,labels};
})();