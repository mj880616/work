// Prevent calendar event layers from triggering each other's repaint observers.
(function(){
  const NativeObserver=window.MutationObserver;
  if(!NativeObserver||window.__KPTU_CALENDAR_OBSERVER_STABLE__)return;
  function isEventNode(node){
    return node?.nodeType===1 && (node.matches?.('.cal-event') || !!node.querySelector?.('.cal-event'));
  }
  function onlyEventLayerChanges(records){
    let saw=false;
    for(const record of records){
      const nodes=[...record.addedNodes,...record.removedNodes];
      if(!nodes.length)continue;
      saw=true;
      if(nodes.some(node=>!isEventNode(node)))return false;
    }
    return saw;
  }
  window.MutationObserver=class extends NativeObserver{
    constructor(callback){
      let calendarGrid=false;
      super((records,observer)=>{
        if(calendarGrid && onlyEventLayerChanges(records))return;
        callback(records,observer);
      });
      this.__setCalendarGrid=value=>{calendarGrid=value};
    }
    observe(target,options){
      this.__setCalendarGrid?.(target?.id==='calendarGrid');
      return super.observe(target,options);
    }
  };
  window.__KPTU_CALENDAR_OBSERVER_STABLE__=true;
})();
