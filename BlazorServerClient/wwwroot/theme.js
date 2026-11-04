// Dark mode: data-theme on <html>, stored in localStorage under "tasks-theme".
// Loaded in <head> so the theme is set before first paint. <html> sits outside the
// interactive Blazor tree, so renders never reset the attribute.
(function () {
    var KEY = 'tasks-theme';

    function stored() {
        try {
            var v = localStorage.getItem(KEY);
            return v === 'dark' || v === 'light' ? v : null;
        } catch (e) { return null; }
    }

    function preferred() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
    }

    apply(stored() || preferred());

    // Follow the system while the user has not chosen a theme.
    if (window.matchMedia) {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        var onChange = function () { if (!stored()) apply(preferred()); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-testid="theme-toggle"]');
        if (!btn) return;
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (err) { }
        apply(next);
    });
})();
