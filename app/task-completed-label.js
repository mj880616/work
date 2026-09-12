function normalizeTaskActions(root=document){
  root.querySelectorAll?.('.tl-task-actions').forEach(row=>{
    const edit=row.querySelector('[data-tl-edit],[data-pt-edit]');
    const del=row.querySelector('[data-tl-delete],[data-pt-delete]');
    const toggle=row.querySelector('[data-tl-toggle],[data-pt-toggle]');
    if(edit)row.appendChild(edit);
    if(del)row.appendChild(del);
    if(toggle)row.appendChild(toggle);
  });
  root.querySelectorAll?.('[data-tl-toggle]').forEach(btn=>{
    if(btn.dataset.done==='1'||btn.textContent.trim()==='되돌리기')btn.textContent='미완료로 변경';
  });
  root.querySelectorAll?.('[data-pt-toggle]').forEach(btn=>{
    if(btn.textContent.trim()==='되돌리기')btn.textContent='미완료로 변경';
  });
}

normalizeTaskActions();
const observer=new MutationObserver(records=>{
  for(const record of records){
    for(const node of record.addedNodes){
      if(node.nodeType===1)normalizeTaskActions(node);
    }
  }
});
observer.observe(document.body,{childList:true,subtree:true});
