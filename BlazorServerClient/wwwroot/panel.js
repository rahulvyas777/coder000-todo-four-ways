// Escape closes the detail panel (unless the key is meant for a field being typed in): it
// clicks panel-close, so the server-side close handler does the navigation.
(() => {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const el = e.target;
    if (el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]')) return;
    document.querySelector('[data-testid="panel-close"]')?.click();
  });
})();
