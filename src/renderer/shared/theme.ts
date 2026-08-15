// Applies the light/dark theme by toggling data-theme on <html>, matching
// the :root[data-theme="light"] override block in shared/index.css. Call
// once at renderer startup (reads the persisted value via
// api.settings.getAll(), same place every renderer already reads config
// from) and again on every live settings:themeChanged push, so a toggle in
// the Settings window updates every open window/view without a restart.
export function applyTheme(theme: 'dark' | 'light') {
  if (theme === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
}

export function initTheme() {
  const api = window.electronAPI
  api.settings.getAll().then(cfg => applyTheme(cfg.theme)).catch(() => {})
  api.settings.onThemeChanged(applyTheme)
}
