// 숨은 칸막이 한글 엔진(HWP 편집기와 같은 엔진·같은 칸막이 hwp-frame.js): 처음 쓸 때 만들고 close()로 지운다. 이 기기 안에서만 바꾼다.
// toHwpx: .hwp·.hwpx → .hwpx 바이트, toHwp: .hwpx → .hwp 바이트. (주간보고 한글 파일 상자 journal-hwpx.js · 상집 논의 요청 문서 discuss-doc.js)
export function createEngine() {
  let host = null, flight = null;
  const ready = () => flight || (flight = (async () => {
    const {createSandboxedEditor} = await import('./hwp-frame.js');
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true'); host.inert = true;
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden';
    document.body.append(host);
    return createSandboxedEditor(host);
  })().catch(error => { flight = null; host?.remove(); host = null; throw error; }));
  const run = async (bytes, name, out) => { const editor = await ready(); await editor.loadFile(bytes, name, {skipUnsavedGuard:true}); return out === 'hwp' ? editor.exportHwp() : editor.exportHwpx(); };
  return {
    toHwpx: (bytes, name) => run(bytes, name, 'hwpx'),
    toHwp: bytes => run(bytes, 'draft.hwpx', 'hwp'),
    close() { const pending = flight; flight = null; pending?.then(editor => { try { editor.destroy(); } catch { /* gone */ } }).catch(() => {}); host?.remove(); host = null; },
  };
}
