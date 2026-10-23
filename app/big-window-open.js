// ED③-창: one check for "a big write window is open", for both the old window (#mdEditor, md-editor.js) and the new one (#edWindow,
// ed-window.js). Openers use this instead of looking for one id; small on purpose so an opener does not load an editor to ask.
export const BIG_WINDOW_SELECTORS = ['#mdEditor', '#edWindow'];
export function bigWindowOpen(root = document) {
  return !!root.querySelector(BIG_WINDOW_SELECTORS.map(sel => `${sel}:not(.hidden)`).join(','));
}
