// content/drag-dock.js
// Content script autoejecutable e idempotente, inyectado bajo demanda por el
// service worker (mensaje INJECT_DRAG_DOCK). Chromium no entrega de forma
// fiable un drop HTML5 entre WebContents, por lo que durante un arrastre se
// muestra un dock flotante pegado al borde derecho (donde está el side panel).
// Soltar sobre él captura enlace/imagen/selección y lo envía a la extensión.
(() => {
  if (window.__coleccionesDragDockInstalled) return;
  window.__coleccionesDragDockInstalled = true;

  let datosActuales = null;
  let dock = null;

  function absoluta(valor) {
    const crudo = typeof valor === "string" ? valor.trim() : "";
    if (!crudo) return "";
    try {
      return new URL(crudo, document.baseURI || location.href).href;
    } catch {
      return crudo;
    }
  }

  function elemento(objetivo) {
    return objetivo && objetivo.nodeType === 1 ? objetivo : null;
  }

  function contextoDelArrastre(objetivo) {
    const nodo = elemento(objetivo);
    const enlace = nodo && typeof nodo.closest === "function" ? nodo.closest("a[href]") : null;
    const imagen = nodo && typeof nodo.closest === "function" ? nodo.closest("img[src]") : null;
    const seleccion = String(window.getSelection() || "").trim();
    const og =
      document.querySelector('meta[property="og:image"]') ||
      document.querySelector('meta[name="twitter:image"]');
    const icono = document.querySelector('link[rel~="icon"]');

    return {
      url: location.href,
      title: document.title || "",
      selection: seleccion,
      linkUrl: enlace ? absoluta(enlace.getAttribute("href")) : "",
      imageUrl: imagen
        ? absoluta(imagen.currentSrc || imagen.src || imagen.getAttribute("src"))
        : "",
      ogImage: og ? absoluta(og.getAttribute("content")) : "",
      favicon: icono ? absoluta(icono.getAttribute("href")) : "",
    };
  }

  function tieneContexto(datos) {
    return Boolean(
      datos &&
        (datos.linkUrl || datos.imageUrl || datos.selection || datos.url)
    );
  }

  function crearDock() {
    if (dock) return dock;
    dock = document.createElement("div");
    dock.id = "colecciones-drag-dock";
    dock.setAttribute("role", "button");
    dock.setAttribute("aria-label", "Guardar en Colecciones");
    dock.textContent = "Guardar en Colecciones ▸";
    Object.assign(dock.style, {
      position: "fixed",
      right: "0px",
      top: "35%",
      zIndex: "2147483647",
      padding: "18px 10px",
      background: "#0f6cbd",
      color: "#ffffff",
      borderRadius: "10px 0 0 10px",
      boxShadow: "0 2px 12px rgba(0,0,0,.35)",
      font: "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif",
      writingMode: "vertical-rl",
      letterSpacing: ".04em",
      cursor: "copy",
      userSelect: "none",
    });

    dock.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dock.style.background = "#084f8c";
    });
    dock.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    dock.addEventListener("dragleave", () => {
      dock.style.background = "#0f6cbd";
    });
    dock.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const datos = datosActuales || contextoDelArrastre(event.target);
      if (tieneContexto(datos)) {
        chrome.runtime.sendMessage(
          { type: "DOCK_DROP", contexto: datos },
          () => void chrome.runtime.lastError
        );
      }
      ocultar();
    });
    document.body.appendChild(dock);
    return dock;
  }

  function mostrar() {
    const nodo = crearDock();
    nodo.style.display = "block";
  }

  function ocultar() {
    datosActuales = null;
    if (dock) {
      dock.style.display = "none";
      dock.style.background = "#0f6cbd";
    }
  }

  document.addEventListener(
    "dragstart",
    (event) => {
      const datos = contextoDelArrastre(event.target);
      if (!datos.linkUrl && !datos.imageUrl && !datos.selection) return;
      datosActuales = datos;
      mostrar();
    },
    true
  );

  document.addEventListener("dragend", ocultar, true);
  window.addEventListener("blur", ocultar);
})();
