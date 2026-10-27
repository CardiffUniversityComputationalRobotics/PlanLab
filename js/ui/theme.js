/* theme.js — PlanLab's colours, light or dark (css/theme.css), set by data-theme on <html>.
 *
 * They follow VS Code's theme in the extension, or the system setting in a browser, until you use the light/dark
 * switch next to the status in the header. Your choice is then kept with your work and wins from then on. It only
 * changes PlanLab's colours, never VS Code's.
 *
 * Loaded straight after saved-state.js, so the colours are right before anything is drawn.
 */
const Theme = (() => {
  'use strict';
  const { $ } = Util;
  const button = $('#themeSwitch');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const valid = (theme) => (theme === 'light' || theme === 'dark' ? theme : null);

  let choice = valid((SavedState.read() || {}).theme);   // 'light' | 'dark' once you have used the switch
  let vscodeTheme = null;                                // 'light' | 'dark' in the VS Code extension

  /** The theme showing: yours, else VS Code's, else the system's. */
  const current = () => choice || vscodeTheme || (systemDark.matches ? 'dark' : 'light');

  /** Sets data-theme and the switch. In a browser, until you choose, there is no data-theme: theme.css follows the system. */
  function apply() {
    const root = document.documentElement, dark = current() === 'dark';
    if (choice || vscodeTheme) root.dataset.theme = current(); else delete root.dataset.theme;
    button.setAttribute('aria-checked', String(dark));
    button.title = `Switch PlanLab to ${dark ? 'light' : 'dark'} colours. VS Code's own colours stay as they are.`;
  }

  /** The switch: the other theme, kept with your work. */
  function toggle() {
    choice = current() === 'dark' ? 'light' : 'dark';
    apply();
    SavedState.save();
  }

  // VS Code puts vscode-light, vscode-dark, vscode-high-contrast or vscode-high-contrast-light on the body
  if (Host.inVSCode) {
    const readVSCodeTheme = () => {
      const c = document.body.classList;
      vscodeTheme = c.contains('vscode-light') || c.contains('vscode-high-contrast-light') ? 'light' : 'dark';
      apply();
    };
    readVSCodeTheme();
    new MutationObserver(readVSCodeTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  systemDark.addEventListener('change', apply);
  apply();

  function init() { button.addEventListener('click', toggle); }

  return {
    init, current,
    /** Your choice, for saving: 'light', 'dark', or null to follow VS Code or the system. */
    choice: () => choice,
  };
})();
