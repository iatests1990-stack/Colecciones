// content/bing-saves.js
// Scraper del DOM de bing.com/saves. Content script autoejecutable inyectado
// bajo demanda por el service worker (mensaje INJECT_BING_SCRAPER, Task 7).
//
// Principios (Tasks 4/8/9 + spec §6.6):
//   - Solo DOM: sin peticiones de red propias, sin cookies, sin fetch.
//   - Las miniaturas se entregan como `thumbnailUrl` (cadena). Nunca se
//     descargan ni se incrustan bytes de imagen.
//   - Mensajes: BING_PROGRESS por colección y BING_RESULT con el payload que
//     espera lib/bingsaves.js:
//       {rootName, collections:[{name, items:[{title,url,thumbnailUrl?,
//        type?,text?}], skipped}], skipped}
//   - La raíz se detecta de forma independiente del idioma (pestaña activa al
//     cargar) y se emite SIEMPRE primero.
//   - Si Bing cambia su marcado, parchear SOLO el objeto SEL y documentar aquí
//     el selector nuevo. `fixtures/bing-saves.sample.html` reproduce la
//     estructura que consumen estos selectores.
(() => {
  "use strict";

  if (window.__coleccionesBingScraperInstalled) return;
  window.__coleccionesBingScraperInstalled = true;

  // --- Selectores centralizados (único punto a parchear) ------------------
  const SEL = {
    // Tiles de carpeta + pestañas de la barra lateral. La unión de ambos,
    // tras expandir «Ver más», cubre también las colecciones ocultas.
    collection: '.collection, [role="tab"].collection',
    card: ".card",
    refreshCard: ".card.card_refresh",
    cardLink: "a.card__link",
    cardTitle: ".card__title",
    cardLabel: ".card__label",
    cardFootnote: ".card__footnote",
    thumb: "img[src]",
    // Pestaña activa (identifica la raíz y confirma el destino de cada salto).
    activeTab:
      '[role="tab"].collection[aria-selected="true"], .collection[aria-selected="true"], .collection[aria-current="page"]',
    // Enlaces de acceso: solo se usan para distinguir «sin sesión» de AAD vacío.
    signInLink:
      'a[href*="login.live.com"], a[href*="login.microsoftonline"], a[href*="/signin"]',
    // Controles auxiliares: se filtran por texto para no depender del idioma.
    seeMore: 'button, a, [role="button"], [role="tab"]',
  };

  const MAX_SCROLLS = 30;
  const MAX_VIEW_WAIT_MS = 4000;
  const WAIT_STEP_MS = 120;
  const ROOT_FALLBACK = "Guardados";

  // --- Helpers puros (sin chrome, sin DOM) --------------------------------

  function cleanText(valor) {
    return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
  }

  function normalizeName(valor) {
    return cleanText(valor).toLowerCase();
  }

  // Confirma que la vista a la que se ha navegado es realmente la esperada.
  // Un cambio de `location.search` por sí solo NO basta: sin pestaña activa
  // coincidente se rechaza para no atribuir tarjetas ajenas a esta colección.
  function vistaCorresponde(nombreEsperado, estado) {
    const esperado = normalizeName(nombreEsperado);
    const activa = cleanText(estado && typeof estado === "object" ? estado.activa : "");
    if (!esperado || !activa) return false;
    return normalizeName(activa) === esperado;
  }

  function absoluteUrl(valor, base) {
    const crudo = typeof valor === "string" ? valor.trim() : "";
    if (!crudo) return "";
    try {
      return new URL(crudo, base || "https://www.bing.com/saves").href;
    } catch {
      return crudo;
    }
  }

  function isValidHttpUrl(valor) {
    const crudo = typeof valor === "string" ? valor.trim() : "";
    if (!crudo || /^#/.test(crudo)) return false;
    try {
      const url = new URL(crudo, "https://www.bing.com/saves");
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  // Bing aplica la clase `card_refresh` a TODAS las tarjetas (verificado en
  // vivo el 2026-11-23: cards === card_refresh en las 34 vistas), así que no
  // sirve para identificar los tiles de colección. El criterio fiable es el
  // destino del enlace: los tiles navegan dentro de /saves; las tarjetas de
  // contenido apuntan a páginas externas.
  function esEnlaceDeColeccion(url) {
    const crudo = typeof url === "string" ? url.trim() : "";
    if (!crudo) return false;
    try {
      const u = new URL(crudo, "https://www.bing.com/saves");
      if (!/(^|\.)bing\.com$/i.test(u.hostname)) return false;
      return u.pathname.indexOf("/saves") !== -1;
    } catch {
      return false;
    }
  }

  function deriveTitle(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // Convierte el registro leído de una tarjeta en un ítem del payload.
  // Devuelve null SOLO cuando la tarjeta está realmente vacía: esa tarjeta se
  // contabiliza en `skipped`, nunca también como ítem.
  function cardToItem(registro) {
    const r = registro && typeof registro === "object" ? registro : {};
    const url = isValidHttpUrl(r.url) ? String(r.url).trim() : "";
    const title = cleanText(r.title);
    const text = cleanText(r.text);
    const thumb = isValidHttpUrl(r.thumbnailUrl) ? String(r.thumbnailUrl).trim() : "";

    if (url) {
      const item = { type: "page", title: title || deriveTitle(url) || url, url };
      if (text) item.text = text;
      if (thumb) item.thumbnailUrl = thumb;
      return item;
    }
    const textoNota = text || title;
    if (textoNota) {
      const item = {
        type: "note",
        title: title || textoNota.slice(0, 60),
        url: "",
        text: textoNota,
      };
      if (thumb) item.thumbnailUrl = thumb;
      return item;
    }
    if (thumb) {
      return { type: "image", title: title || "Imagen", url: "", thumbnailUrl: thumb };
    }
    return null;
  }

  // Detecta la pantalla sin sesión. Exige (a) que no haya colecciones visibles,
  // (b) el texto de «empezar a recopilar» y (c) una señal explícita de acceso
  // («Sign in» / enlace a login). Así una cuenta de empresa autenticada sin
  // colecciones cae al payload vacío y el panel muestra import.bing.empty,
  // en lugar de pedir un login que ya está hecho.
  function isLoginScreen(texto, opciones = {}) {
    if (opciones.hasCollections) return false;
    const t = String(texto || "");
    const inicio = [/start collecting/i, /empieza a recopilar/i, /empezar a recopilar/i];
    const acceso = [/sign in/i, /iniciar sesión/i, /iniciar sesion/i, /inicia sesión/i, /log in/i];
    if (!inicio.some((re) => re.test(t))) return false;
    return opciones.hasSignInLink === true || acceso.some((re) => re.test(t));
  }

  // Deduplica URLs dentro de una colección. Los duplicados NO se cuentan como
  // tarjetas omitidas: son duplicados, no tarjetas vacías.
  function dedupeCollection(col) {
    const fuente = col && typeof col === "object" ? col : {};
    const vistos = new Set();
    const items = [];
    for (const item of Array.isArray(fuente.items) ? fuente.items : []) {
      if (!item) continue;
      if (item.url && vistos.has(item.url)) continue;
      if (item.url) vistos.add(item.url);
      items.push(item);
    }
    return {
      name: cleanText(fuente.name),
      items,
      skipped: Number.isFinite(fuente.skipped) ? fuente.skipped : 0,
    };
  }

  // Ensambla el payload: la raíz va primero y sus URLs se deduplican contra
  // las colecciones con nombre. `skipped` es el total coherente, sin contar
  // dos veces una tarjeta vacía ya convertida en nota/imagen.
  function buildPayload(rootName, collections) {
    const nombre = cleanText(rootName) || ROOT_FALLBACK;
    const lista = Array.isArray(collections) ? collections : [];
    const raiz = lista[0] || { name: nombre, items: [], skipped: 0 };
    const resto = lista.slice(1).map(dedupeCollection);

    const urlsNombradas = new Set();
    for (const col of resto) {
      for (const item of col.items) if (item.url) urlsNombradas.add(item.url);
    }
    const vistosRaiz = new Set();
    const itemsRaiz = [];
    for (const item of Array.isArray(raiz.items) ? raiz.items : []) {
      if (!item) continue;
      if (item.url && (vistosRaiz.has(item.url) || urlsNombradas.has(item.url))) continue;
      if (item.url) vistosRaiz.add(item.url);
      itemsRaiz.push(item);
    }

    const salida = [
      {
        name: cleanText(raiz.name) || nombre,
        items: itemsRaiz,
        skipped: Number.isFinite(raiz.skipped) ? raiz.skipped : 0,
      },
      ...resto,
    ];
    const skipped = salida.reduce(
      (suma, col) => suma + (Number.isFinite(col.skipped) ? col.skipped : 0),
      0
    );
    return { rootName: salida[0].name, collections: salida, skipped };
  }

  // --- Acceso al DOM ------------------------------------------------------

  function base() {
    return document.baseURI || location.href || "https://www.bing.com/saves";
  }

  function textOf(nodo) {
    if (!nodo || nodo.nodeType !== 1) return "";
    return cleanText(nodo.innerText || nodo.textContent || "");
  }

  function nombreDeColeccion(nodo) {
    const crudo =
      textOf(nodo) ||
      cleanText((nodo.getAttribute && nodo.getAttribute("aria-label")) || "") ||
      cleanText((nodo.getAttribute && nodo.getAttribute("title")) || "");
    return crudo.slice(0, 120);
  }

  function enPaginaSaves() {
    const host = (typeof location !== "undefined" && location.hostname) || "";
    const ruta = (typeof location !== "undefined" && location.pathname) || "";
    return /(^|\.)bing\.com$/i.test(host) && ruta.indexOf("/saves") !== -1;
  }

  function enviar(mensaje) {
    try {
      chrome.runtime.sendMessage(mensaje, () => void chrome.runtime.lastError);
    } catch {
      // La pestaña puede haberse recargado: ya no hay canal al que informar.
    }
  }

  // Instrumentación temporal de diagnóstico (fase 1 de depuración): informa
  // del estado en cada límite de componentes sin alterar el resultado final.
  function depurar(etapa, datos) {
    try {
      chrome.runtime.sendMessage({ type: "BING_DEBUG", etapa, datos });
    } catch {
      /* sin canal */
    }
  }

  function dormir(ms) {
    return new Promise((resolver) => setTimeout(resolver, ms));
  }

  function esperarDOMListo() {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      return Promise.resolve();
    }
    return new Promise((resolver) => {
      document.addEventListener("DOMContentLoaded", resolver, { once: true });
      setTimeout(resolver, 3000);
    });
  }

  function scrollAbajo() {
    try {
      window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
    } catch {
      // Algunos marcos no permiten desplazamiento.
    }
  }

  // Carga incremental: Bing añade tarjetas al hacer scroll. Se considera
  // estabilizado cuando el número de tarjetas no cambia dos veces seguidas.
  async function estabilizarTarjetas() {
    let anterior = -1;
    let estables = 0;
    for (let i = 0; i < MAX_SCROLLS; i += 1) {
      const actual = document.querySelectorAll(SEL.card).length;
      // Una vista con cero tarjetas NO está estabilizada: Bing es una SPA y
      // puede renderizarlas tarde. Esperar a que aparezca al menos una evita
      // importar colecciones vacías cuando la carga es lenta.
      if (actual > 0 && actual === anterior) {
        estables += 1;
        if (estables >= 2) return;
      } else {
        estables = 0;
        anterior = actual;
      }
      scrollAbajo();
      await dormir(WAIT_STEP_MS);
    }
  }

  // Lee una tarjeta del DOM. Las tarjetas de refresco (placeholders) se
  // descartan: no son contenido del usuario y no deben contarse como omitidas.
  function leerTarjeta(nodo) {
    if (!nodo || nodo.nodeType !== 1) return null;
    // No se descarta por `card_refresh`: en el Bing actual TODAS las tarjetas
    // llevan esa clase. Solo se omiten los tiles que enlazan a otra colección.
    // La tarjeta puede ser ella misma el enlace, no solo contenerlo.
    const enlace =
      (typeof nodo.matches === "function" && nodo.matches(SEL.cardLink))
        ? nodo
        : typeof nodo.querySelector === "function"
          ? nodo.querySelector(SEL.cardLink)
          : null;
    let url = "";
    if (enlace) {
      const href = enlace.getAttribute("href") || enlace.href || "";
      if (isValidHttpUrl(href)) url = absoluteUrl(href, base());
    }
    if (esEnlaceDeColeccion(url)) return null;

    const titulo =
      textOf(nodo.querySelector(SEL.cardTitle)) ||
      (enlace
        ? cleanText(enlace.getAttribute("title") || enlace.getAttribute("aria-label"))
        : "");
    const etiqueta = textOf(nodo.querySelector(SEL.cardLabel));
    const pie = textOf(nodo.querySelector(SEL.cardFootnote));
    const texto = [titulo, etiqueta, pie].filter(Boolean).join("\n").trim();

    let thumbnailUrl = "";
    const imagen = typeof nodo.querySelector === "function" ? nodo.querySelector(SEL.thumb) : null;
    if (imagen) {
      const src = imagen.getAttribute("src") || imagen.currentSrc || imagen.src || "";
      const abs = absoluteUrl(src, base());
      if (isValidHttpUrl(abs)) thumbnailUrl = abs;
    }
    return { url, title: titulo, text: texto, thumbnailUrl };
  }

  function leerTarjetas() {
    const vistos = new Set();
    const registros = [];
    document.querySelectorAll(SEL.card).forEach((nodo) => {
      const registro = leerTarjeta(nodo);
      if (!registro) return;
      const clave = registro.url || normalizeName(registro.title + "|" + registro.text);
      if (vistos.has(clave)) return;
      vistos.add(clave);
      registros.push(registro);
    });
    return registros;
  }

  async function scraperVistaActual(nombre) {
    await estabilizarTarjetas();
    const items = [];
    let skipped = 0;
    for (const registro of leerTarjetas()) {
      const item = cardToItem(registro);
      if (item) items.push(item);
      else skipped += 1;
    }
    return { name: cleanText(nombre) || ROOT_FALLBACK, items, skipped };
  }

  // Unión de tiles de carpeta y pestañas del rail, deduplicada por nombre.
  function descubrirColecciones() {
    const vistos = new Set();
    const entradas = [];
    document.querySelectorAll(SEL.collection).forEach((nodo, indice) => {
      if (!nodo || nodo.nodeType !== 1) return;
      const nombre = nombreDeColeccion(nodo);
      if (!nombre) return;
      const clave = normalizeName(nombre);
      if (vistos.has(clave)) return;
      vistos.add(clave);
      const clases = typeof nodo.className === "string" ? nodo.className : "";
      const activa =
        (nodo.getAttribute && nodo.getAttribute("aria-selected") === "true") ||
        (nodo.getAttribute && nodo.getAttribute("aria-current") === "page") ||
        /\b(active|selected|activa|seleccionada)\b/i.test(clases);
      entradas.push({ nombre, activa, nodo, indice });
    });
    return entradas;
  }

  // Revela las colecciones ocultas tras «Ver más» (texto multilingüe).
  async function expandirVerMas() {
    const patron =
      /ver más|ver mas|mostrar más|mostrar todos|see more|see all|show more|tout voir|mehr anzeigen|mostra altro|mostrar mais/i;
    let clics = 0;
    document.querySelectorAll(SEL.seeMore).forEach((control) => {
      if (clics >= 3) return;
      const texto = textOf(control);
      if (!texto || texto.length > 40 || !patron.test(texto)) return;
      const href = typeof control.getAttribute === "function" ? control.getAttribute("href") : null;
      if (href && !/saves/i.test(href) && !/^#/.test(href)) return;
      try {
        control.click();
        clics += 1;
      } catch {
        // Control no interactivo: se ignora.
      }
    });
    if (clics) await dormir(WAIT_STEP_MS * 3);
  }

  // Snapshot de la vista. La pestaña activa es la confirmación del destino;
  // `search`/`hash`/`href` se conservan como contexto y para depuración.
  function estadoVista() {
    const activa = document.querySelector(SEL.activeTab);
    return {
      search: location.search || "",
      hash: location.hash || "",
      href: location.href || "",
      activa: activa ? nombreDeColeccion(activa) : "",
    };
  }

  // Espera a que la PESTAÑA ACTIVA corresponda a la colección destino. Un mero
  // cambio de `search`/`hash` no confirma nada y no permite atribuir tarjetas.
  async function esperarCambioDeVista(nombreEsperado) {
    const intentos = Math.ceil(MAX_VIEW_WAIT_MS / WAIT_STEP_MS);
    for (let i = 0; i < intentos; i += 1) {
      if (vistaCorresponde(nombreEsperado, estadoVista())) return true;
      await dormir(WAIT_STEP_MS);
    }
    return false;
  }

  // Devuelve true SOLO si el salto terminó en la colección pedida. Un clic
  // fallido o una vista no confirmada se informa como false para que el llamador
  // omita la colección en lugar de etiquetar con su nombre tarjetas ajenas.
  async function navegar(entrada) {
    try {
      entrada.nodo.click();
    } catch {
      return false;
    }
    // Bing es una SPA: no hay recarga; la confirmación es la pestaña activa.
    if (!(await esperarCambioDeVista(entrada.nombre))) return false;
    await dormir(WAIT_STEP_MS * 3);
    return vistaCorresponde(entrada.nombre, estadoVista());
  }

  async function main() {
    if (!enPaginaSaves()) {
      enviar({ type: "BING_RESULT", payload: null, error: "WRONG_PAGE" });
      return;
    }
    try {
      await esperarDOMListo();
      depurar("inicio", {
        href: location.href,
        ready: document.readyState,
        cards: document.querySelectorAll(SEL.card).length,
        refresh: document.querySelectorAll(SEL.refreshCard).length,
        conLink: document.querySelectorAll(SEL.cardLink).length,
        colecciones: document.querySelectorAll(SEL.collection).length,
      });
      const conColecciones = document.querySelectorAll(SEL.collection).length > 0;
      const texto = (document.body && (document.body.innerText || document.body.textContent)) || "";
      const conEnlaceAcceso = Boolean(document.querySelector(SEL.signInLink));
      if (isLoginScreen(texto, {
        hasCollections: conColecciones,
        hasSignInLink: conEnlaceAcceso,
      })) {
        enviar({ type: "BING_RESULT", payload: null, error: "NO_LOGIN" });
        return;
      }

      await expandirVerMas();
      const entradas = descubrirColecciones();
      depurar("descubiertas", {
        total: entradas.length,
        raiz: (entradas.find((entrada) => entrada.activa) || {}).nombre || ROOT_FALLBACK,
      });
      const raiz = (entradas.find((entrada) => entrada.activa) || {}).nombre || ROOT_FALLBACK;
      const colecciones = [];

      // 1) La raíz es la vista activa al cargar: no se navega y va primero.
      const vistaRaiz = await scraperVistaActual(raiz);
      depurar("raiz", {
        nombre: vistaRaiz.name,
        items: vistaRaiz.items.length,
        skipped: vistaRaiz.skipped,
        cards: document.querySelectorAll(SEL.card).length,
        refresh: document.querySelectorAll(SEL.refreshCard).length,
        conLink: document.querySelectorAll(SEL.cardLink).length,
      });
      colecciones.push(vistaRaiz);
      const raizNorm = normalizeName(vistaRaiz.name);
      const pendientes = entradas.filter(
        (entrada) => normalizeName(entrada.nombre) !== raizNorm
      );
      const total = 1 + pendientes.length;
      enviar({
        type: "BING_PROGRESS",
        current: 1,
        total,
        name: vistaRaiz.name,
      });

      // 2) Visita el resto de colecciones (tiles + rail ya unidos). Si el salto
      //    no se confirma, se omite: NUNCA se atribuyen tarjetas de otra vista
      //    al nombre de la colección esperada.
      let actual = 1;
      const omitidas = [];
      for (const entrada of pendientes) {
        actual += 1;
        const confirmada = await navegar(entrada);
        if (!confirmada) {
          omitidas.push(entrada.nombre);
          enviar({
            type: "BING_PROGRESS",
            current: actual,
            total,
            name: `${entrada.nombre}: omitida (no se pudo abrir)`,
          });
          continue;
        }
        enviar({ type: "BING_PROGRESS", current: actual, total, name: entrada.nombre });
        const vista = await scraperVistaActual(entrada.nombre);
        depurar("vista", {
          nombre: vista.name,
          items: vista.items.length,
          skipped: vista.skipped,
          cards: document.querySelectorAll(SEL.card).length,
          refresh: document.querySelectorAll(SEL.refreshCard).length,
          conLink: document.querySelectorAll(SEL.cardLink).length,
        });
        colecciones.push(vista);
      }

      const payload = buildPayload(raiz, colecciones);
      // El resumen final del panel (import.skipped) incluye las colecciones que
      // no se pudieron abrir; sus nombres ya se mostraron en el progreso.
      if (omitidas.length) payload.skipped += omitidas.length;
      const conItems = payload.collections.some((col) => col.items.length > 0);
      depurar("resultado", {
        conItems,
        colecciones: payload.collections.length,
        elementos: payload.collections.reduce((n, c) => n + c.items.length, 0),
        omitidas: omitidas.length,
      });
      console.log("[bing-import]", "resumen", {
        colecciones: payload.collections.length,
        conItems,
        elementos: payload.collections.reduce((n, c) => n + c.items.length, 0),
        omitidas: omitidas.length,
      });
      enviar({
        type: "BING_RESULT",
        // Sin ítems: payload vacío para que el panel muestre import.bing.empty
        // (cuenta de empresa/AAD), no una vista previa con 0 elementos.
        payload: conItems
          ? payload
          : { rootName: "", collections: [], skipped: payload.skipped },
        error: conItems ? undefined : "EMPTY_RESULT",
        detalle: conItems
          ? undefined
          : `${payload.collections.length} colecciones; ` +
            payload.collections.map((c) => `${c.name}:${c.items.length}`).join(", "),
      });
    } catch (err) {
      // Fallo inesperado de marcado: se informa del motivo y se entrega un
      // payload vacío para que el panel explique qué ha ocurrido.
      const motivo = String((err && err.message) || err || "error desconocido");
      depurar("error", { motivo });
      console.error("[bing-import]", "fallo", motivo, err);
      enviar({
        type: "BING_RESULT",
        error: "PARSE_ERROR",
        detalle: motivo,
        payload: { rootName: "", collections: [], skipped: 0 },
      });
    }
  }

  // --- Gancho de pruebas --------------------------------------------------
  // Permite verificar los helpers puros con `node --test` cargando este
  // archivo en un contexto vm. En la extensión este bloque nunca se activa.
  if (globalThis.__COLECCIONES_BING_TEST__ === true) {
    globalThis.__bingScraperTest = {
      SEL,
      cardToItem,
      buildPayload,
      dedupeCollection,
      isLoginScreen,
      absoluteUrl,
      isValidHttpUrl,
      esEnlaceDeColeccion,
      normalizeName,
      vistaCorresponde,
      cleanText,
      enPaginaSaves,
    };
    return;
  }

  main().catch((err) => {
    const motivo = String((err && err.message) || err || "error desconocido");
    depurar("error-main", { motivo });
    console.error("[bing-import]", "fallo en main", motivo, err);
    enviar({
      type: "BING_RESULT",
      error: "PARSE_ERROR",
      detalle: motivo,
      payload: { rootName: "", collections: [], skipped: 0 },
    });
  });
})();
