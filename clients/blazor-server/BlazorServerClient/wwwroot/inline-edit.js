// Inline editors open in the browser at once. On Blazor Server the editor would otherwise
// appear (and take focus) only after a round-trip to the server, and keystrokes typed right
// after the click would be lost. The server-side handlers still run and keep the state.
//
// Markup: a host element with [data-inline-edit-host] holds the hidden editor
// [data-inline-edit-input] and a trigger [data-inline-edit="click"|"dblclick"]. The host gets
// the attribute data-editing; the server renders the same attribute while it is editing. (Not
// a class: a server render that changes the class for another reason would drop it.)
(() => {
  function open(e) {
    const trigger = e.target.closest?.(`[data-inline-edit="${e.type}"]`);
    if (!trigger) return;
    const host = trigger.closest('[data-inline-edit-host]');
    const input = host?.querySelector('[data-inline-edit-input]');
    if (!input) return;
    host.setAttribute('data-editing', '');
    input.focus();
    input.select();
  }
  document.addEventListener('click', open);
  document.addEventListener('dblclick', open);
})();
