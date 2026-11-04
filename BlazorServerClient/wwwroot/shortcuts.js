// Single-key shortcuts. n and / only move focus, so they are handled here; j, k, x, Delete,
// Enter and ? change page state and are sent to the page's .NET object. Escape stays in
// panel.js. Keys typed into a field, or pressed with Ctrl, Alt or Meta, are left alone.
window.taskShortcuts = (() => {
  let page = null;
  const forwarded = new Set(['j', 'k', 'x', 'Delete', 'Enter', '?']);
  const typing = 'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]';

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest(typing)) return;

    const focusId = e.key === 'n' ? 'task-add-input' : e.key === '/' ? 'search-input' : null;
    if (focusId) {
      const input = document.querySelector(`[data-testid="${focusId}"]`);
      if (!input) return;
      e.preventDefault();
      input.focus();
      return;
    }

    if (!forwarded.has(e.key) || !page) return;
    // Enter on a focused button, link or checkbox keeps its native meaning.
    if (e.key === 'Enter' && el?.closest('button, a, input, summary')) return;
    e.preventDefault();
    page.invokeMethodAsync('Shortcut', e.key);
  });

  return {
    register: (ref) => { page = ref; },
    unregister: (ref) => { if (page === ref) page = null; },
  };
})();
