function caeUiSync(){
  const modal=document.querySelector('#caeModal');
  if(!modal)return;
  const card=modal.querySelector('.cae-card');
  if(!card)return;
  const head=card.querySelector('.modal-head');
  if(head&&!head.dataset.appHero){
    head.dataset.appHero='1';
    const copy=head.querySelector('div');
    const eyebrow=copy?.querySelector('#caeEyebrow,.eyebrow');
    const oldH2=copy?.querySelector('h2');
    if(copy&&oldH2){
      oldH2.remove();
      const hero=document.createElement('div');
      hero.className='cae-hero';
      hero.innerHTML='<span id="caeHeroColor" class="cae-hero-color"></span><h2 id="caeHeroTitle">일정</h2>';
      copy.appendChild(hero);
      const note=document.createElement('div');
      note.className='cae-hero-note';
      note.textContent='등록된 일정의 내용을 확인하고 필요한 항목만 수정합니다.';
      copy.appendChild(note);
    }
    if(eyebrow)eyebrow.classList.add('cae-eyebrow');
  }
  card.querySelectorAll('.ea-edit-note').forEach(x=>x.remove());
  const scope=document.querySelector('#caeScope');
  if(scope){
    const row=scope.closest('label');
    if(row){row.classList.add('cae-scope-row');row.style.display='none'}
  }
  const title=document.querySelector('#caeTitle')?.value.trim()||'제목 없는 일정';
  const color=document.querySelector('#caeColor')?.value||'#7656a8';
  const heroTitle=document.querySelector('#caeHeroTitle');
  const heroColor=document.querySelector('#caeHeroColor');
  if(heroTitle)heroTitle.textContent=title;
  if(heroColor)heroColor.style.background=color;
  const save=document.querySelector('#caeSave');
  if(save)save.textContent='변경사항 저장';
}
function caeUiBind(){
  const title=document.querySelector('#caeTitle');
  const color=document.querySelector('#caeColor');
  if(title&&!title.dataset.heroBound){title.dataset.heroBound='1';title.addEventListener('input',caeUiSync)}
  if(color&&!color.dataset.heroBound){color.dataset.heroBound='1';color.addEventListener('input',caeUiSync);color.addEventListener('change',caeUiSync)}
}
const style=document.createElement('style');
style.id='caeHeroStyles';
style.textContent=`
#caeModal .cae-card{border-top:5px solid #315f95}
#caeModal .modal-head{align-items:flex-start}
#caeModal .modal-head>div:first-child{min-width:0;flex:1}
#caeModal .cae-eyebrow{font-size:11px;letter-spacing:.12em;color:#315f95;margin-bottom:5px}
#caeModal .cae-hero{display:flex;align-items:center;gap:10px;min-width:0}
#caeModal .cae-hero h2{font-size:27px;line-height:1.18;margin:0;letter-spacing:-.6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#caeModal .cae-hero-color{width:20px;height:20px;min-width:20px;border-radius:50%;border:1px solid rgba(0,0,0,.08);box-shadow:0 0 0 4px rgba(0,0,0,.025)}
#caeModal .cae-hero-note{font-size:10px;color:#7b8793;margin-top:6px;line-height:1.4}
#caeModal .cae-scope-row{display:none!important}
#caeModal #caeColor{height:42px;padding:3px}
#caeModal .ea-edit-actions{margin-top:12px}
@media(max-width:600px){
  #caeModal .cae-card{padding:17px}
  #caeModal .cae-hero h2{font-size:25px}
  #caeModal .cae-hero-note{font-size:9px}
}
`;
document.head.appendChild(style);

const observer=new MutationObserver(()=>{
  const modal=document.querySelector('#caeModal');
  if(!modal)return;
  if(!modal.classList.contains('hidden')){caeUiSync();caeUiBind()}
});
observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-hidden']});

document.addEventListener('click',e=>{
  if(e.target.closest?.('.cm-app[data-app-event]'))setTimeout(()=>{caeUiSync();caeUiBind()},80);
},true);
setTimeout(()=>{caeUiSync();caeUiBind()},0);
