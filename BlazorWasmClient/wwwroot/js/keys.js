// Document-level keys for the list page. Escape closes the detail panel, except while typing in
// a field outside the panel (inline editors there handle Escape themselves).
export function register(dotnet) {
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target;
    const typing = t instanceof HTMLElement && t.matches('input, textarea, select, [contenteditable="true"]');
    if (typing && !t.closest('.panel')) return;
    dotnet.invokeMethodAsync('OnEscape');
  };
  document.addEventListener('keydown', onKey);
  return { dispose: () => document.removeEventListener('keydown', onKey) };
}
