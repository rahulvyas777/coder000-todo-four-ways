// Escape clears the bulk selection, or else closes the detail panel (unless the key is meant for
// a field being typed in): it clicks the bulk bar's clear button or panel-close, so the
// server-side handlers do the work.
(() => {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const el = e.target;
    if (el instanceof HTMLElement && el.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
    const target = document.querySelector('[data-bulk-clear]') ?? document.querySelector('[data-testid="panel-close"]');
    target?.click();
  });
})();
