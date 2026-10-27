// ED③-창: one check for "a big write window is open" (#edWindow, ed-window.js; the old big window was deleted in ED③ 순서 6). Openers use this instead of looking for one id; small on purpose so an opener does not load an editor to ask.
export const BIG_WINDOW_SELECTORS = ['#edWindow'];
export function bigWindowOpen(root = document) {
  return !!root.querySelector(BIG_WINDOW_SELECTORS.map(sel => `${sel}:not(.hidden)`).join(','));
}
