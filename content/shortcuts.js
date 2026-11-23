// content/shortcuts.js — respaldo del atajo para abrir el panel.
// chrome.commands no dispara de forma fiable en este Edge (verificado en vivo),
// así que se detecta Alt+Mayús+C en la página y se pide al service worker que
// abra el side panel mediante el mensaje OPEN_PANEL que ya existe.
(() => {
  if (globalThis.__coleccionesShortcutsInstalled === true) return;
  globalThis.__coleccionesShortcutsInstalled = true;

  document.addEventListener(
    "keydown",
    (evento) => {
      if (!evento || !evento.altKey || !evento.shiftKey) return;
      if (evento.ctrlKey || evento.metaKey) return;
      const tecla = String(evento.key || "").toLowerCase();
      if (tecla !== "c" && evento.code !== "KeyC") return;
      evento.preventDefault();
      try {
        chrome.runtime.sendMessage({ type: "OPEN_PANEL" }, () => void chrome.runtime.lastError);
      } catch {
        /* la pestaña puede estar cerrándose */
      }
    },
    true
  );
})();
