// Document-level keys for the list page. Escape closes the help, the detail panel or clears the
// selection, except while typing in a field outside the panel (inline editors there handle Escape
// themselves). A focused checkbox is not typing, so Escape right after ticking a row still clears it.
// Every other shortcut is ignored while typing in any field.
const rowKeys = new Set(['j', 'k', 'x', 'Delete', 'Enter', '?']);

export function register(dotnet) {
  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    const typing = t instanceof HTMLElement
      && t.matches('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (typing && !t.closest('.panel')) return;
      dotnet.invokeMethodAsync('OnEscape');
      return;
    }
    if (typing) return;
    // Enter on a focused button, link or checkbox keeps its own meaning.
    if (e.key === 'Enter' && t instanceof HTMLElement && t.matches('button, a, input, summary')) return;
    if (e.key === 'n' || e.key === '/') {
      // Focus here, synchronously, and prevent the default so the key is not typed into the field.
      const input = document.querySelector(
        `[data-testid="${e.key === 'n' ? 'task-add-input' : 'search-input'}"]`);
      if (!input) return;
      e.preventDefault();
      input.focus();
      return;
    }
    if (!rowKeys.has(e.key)) return;
    e.preventDefault();
    dotnet.invokeMethodAsync('OnShortcut', e.key);
  };
  document.addEventListener('keydown', onKey);
  return { dispose: () => document.removeEventListener('keydown', onKey) };
}
