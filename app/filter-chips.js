import {watchScrollEdges} from './scroll-edge.js';
// One renderer for list filters. Keep nodes during selection so focus and touch survive refreshes.
export function renderFilterChips(host,{options,value='all',label,onChange,small=false,controls}={}){
  if(!host)return;
  const selected=options.some(o=>o.value===value)?value:options[0]?.value;
  host.classList.add('filter-chips','quick-mode-group');host.classList.toggle('filter-chips-small',small);
  host.setAttribute('role','radiogroup');host.setAttribute('aria-label',label);
  if(controls)host.setAttribute('aria-controls',controls);
  host.value=selected;host._filterChange=onChange;
  const signature=JSON.stringify(options);
  if(host._filterSignature!==signature){
    const focused=host.contains(document.activeElement)?document.activeElement?.dataset.filterValue:null;
    host.replaceChildren(...options.map(o=>{
      const button=document.createElement('button');button.type='button';button.className='quick-pill-button';button.setAttribute('role','radio');button.dataset.filterValue=o.value;
      if(o.color){const dot=document.createElement('span');dot.className='filter-chip-dot';dot.style.backgroundColor=o.color;dot.setAttribute('aria-hidden','true');button.append(dot)}
      button.append(document.createTextNode(o.label));return button;
    }));
    host._filterSignature=signature;
    if(focused)Array.from(host.children).find(b=>b.dataset.filterValue===focused)?.focus({preventScroll:true});
  }
  const buttons=()=>Array.from(host.children);
  function reveal(button){if(!button)return;const box=host.getBoundingClientRect(),r=button.getBoundingClientRect();if(r.left<box.left)host.scrollLeft-=box.left-r.left;else if(r.right>box.right)host.scrollLeft+=r.right-box.right}
  function update(){for(const b of buttons()){const checked=b.dataset.filterValue===host.value;b.setAttribute('aria-checked',String(checked));b.tabIndex=checked?0:-1}reveal(buttons().find(b=>b.tabIndex===0))}
  function choose(button,focus=false){if(!button)return;if(focus)button.focus({preventScroll:true});host.value=button.dataset.filterValue;update();host._filterChange?.(host.value);host.dispatchEvent(new Event('change',{bubbles:true}))}
  if(!host._filterBound){
    host.addEventListener('click',e=>{const b=e.target.closest('[data-filter-value]');if(b?.parentElement===host)choose(b)});
    host.addEventListener('keydown',e=>{
      const b=e.target.closest('[data-filter-value]');if(b?.parentElement!==host)return;
      const list=buttons(),i=list.indexOf(b);let target;
      if(e.key==='ArrowRight')target=list[(i+1)%list.length];else if(e.key==='ArrowLeft')target=list[(i-1+list.length)%list.length];else if(e.key==='Home')target=list[0];else if(e.key==='End')target=list.at(-1);else return;
      e.preventDefault();choose(target,true);
    });
    host._filterBound=true;
  }
  update();
  watchScrollEdges(host);
}
