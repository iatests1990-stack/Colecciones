// content/extractor.js
// Content script autoejecutable, inyectado bajo demanda por el service worker.
// Responde a {type:'EXTRACT_CONTEXT'} con el contexto de la página: URL,
// título, selección, enlace/imagen bajo el cursor del menú contextual,
// og:image y favicon. Sin dependencias y sin peticiones de red propias.
(() => {
  if (window.__coleccionesExtractorInstalled) return;
  window.__coleccionesExtractorInstalled = true;

  let ultimoObjetivo = null;
  document.addEventListener(
    "contextmenu",
    (event) => {
      ultimoObjetivo = event.target;
    },
    true
  );

  function absoluta(valor) {
    const crudo = typeof valor === "string" ? valor.trim() : "";
    if (!crudo) return "";
    try {
      return new URL(crudo, document.baseURI || location.href).href;
    } catch {
      return crudo;
    }
  }

  function contexto(objetivo = ultimoObjetivo) {
    const seleccion = String(window.getSelection() || "").trim();
    const og = document.querySelector('meta[property="og:image"]') ||
      document.querySelector('meta[name="twitter:image"]');
    const icono = document.querySelector('link[rel~="icon"]');

    let enlace = "";
    let imagen = "";
    if (objetivo && objetivo.nodeType === 1 && typeof objetivo.closest === "function") {
      const a = objetivo.closest("a[href]");
      const img = objetivo.closest("img[src]");
      if (a) enlace = absoluta(a.getAttribute("href"));
      if (img) imagen = absoluta(img.currentSrc || img.src || img.getAttribute("src"));
    }

    return {
      url: location.href,
      title: document.title || "",
      selection: seleccion,
      linkUrl: enlace,
      imageUrl: imagen,
      ogImage: og ? absoluta(og.getAttribute("content")) : "",
      favicon: icono ? absoluta(icono.getAttribute("href")) : "",
    };
  }

  chrome.runtime.onMessage.addListener((mensaje, remitente, responder) => {
    if (!mensaje || mensaje.type !== "EXTRACT_CONTEXT") return false;
    try {
      responder(contexto());
    } catch (error) {
      responder(null);
    }
    return false;
  });
})();
