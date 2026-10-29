// SHARE-보관함·HTML공유: receives one HTML file from the parent share page (share.js) and draws it in this sandboxed frame.
// Draws only when sandboxed without allow-same-origin (self.origin is "null") and inside a parent: opened directly, or framed
// without the sandbox, it does nothing, so a file never runs with this site's origin, storage or cookies.
// Old-browser syntax only (Samsung Internet on Chromium 7x): no ?. ?? or arrow-less gaps.
(function () {
  'use strict';
  var sandboxed = false;
  try { sandboxed = self.origin === 'null' && window.parent && window.parent !== window; } catch (e) { sandboxed = false; }
  if (!sandboxed) return;
  function onMessage(event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== 'kptu-share-html' || typeof data.html !== 'string') return;
    window.removeEventListener('message', onMessage);
    document.open();
    document.write(data.html);
    document.close();
  }
  window.addEventListener('message', onMessage);
  window.parent.postMessage({type: 'kptu-share-frame-ready'}, '*');
})();
