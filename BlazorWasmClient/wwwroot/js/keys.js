// Document-level keys for the list page. Escape closes the detail panel or clears the selection,
// except while typing in a field outside the panel (inline editors there handle Escape themselves).
// A focused checkbox is not typing, so Escape right after ticking a row still clears it.
export function register(dotnet) {
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target;
    const typing = t instanceof HTMLElement
      && t.matches('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]');
    if (typing && !t.closest('.panel')) return;
    dotnet.invokeMethodAsync('OnEscape');
  };
  document.addEventListener('keydown', onKey);
  return { dispose: () => document.removeEventListener('keydown', onKey) };
}
