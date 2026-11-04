// The theme lives on <html data-theme>; index.html sets it before first paint.
const key = 'tasks-theme';

export function current() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function toggle() {
  const next = current() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(key, next); } catch { /* storage unavailable: the theme still switches */ }
  return next;
}
