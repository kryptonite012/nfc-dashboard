(function () {
  try {
    var stored = window.localStorage.getItem('vl-theme');
    var dark = stored === 'dark' || ((stored === null || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    /* storage unavailable: fall back to the light theme */
  }
})();
