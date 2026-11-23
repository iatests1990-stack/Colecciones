// background.js — service worker MV3.
// Registra menús contextuales, atajos, comportamiento del side panel y la
// captura de pestañas. NO ejecuta importación, exportación ni sincronización:
// esas operaciones viven en el panel y en el documento offscreen (Tasks 8/11).
import {
  STATE_STORAGE_KEY,
  buildCapturedItem,
  createSerializedQueue,
  isAbsoluteHttpUrl,
} from "./lib/capture.js";
import {
  addItem,
  assignItemToSection,
  createCollection,
  createEmptyState,
  createSection,
  deleteCollection,
  deleteItem,
  deleteSection,
  importIntoState,
  migrate,
  moveItem,
  renumberOrders,
  renameCollection,
  sortCollections,
  updateItem,
} from "./lib/store.js";
import { asegurarDocumentoOffscreen } from "./offscreen/offscreen.js";

const MENU = {
  save: "save-in-collections",
  note: "save-selection-note",
  citation: "save-selection-citation",
};
const COLECCION_POR_DEFECTO = "Capturas";

// Cola única para TODA la persistencia: el load -> add -> store se ejecuta
// sin solapamientos, así dos guardados casi simultáneos no se pierden.
const colaGuardado = createSerializedQueue();

// --- Persistencia (store puro + chrome.storage.local) --------------------

async function leerEstado() {
  const guardado = await chrome.storage.local.get(STATE_STORAGE_KEY);
  const bruto = guardado && guardado[STATE_STORAGE_KEY];
  let estado = bruto ? migrate(bruto) : createEmptyState();
  if (!Array.isArray(estado.collections) || estado.collections.length === 0) {
    estado = createCollection(estado, COLECCION_POR_DEFECTO);
  }
  return estado;
}

async function idColeccionDestino(estado) {
  const preferida = estado.settings && estado.settings.defaultCollectionId;
  if (preferida && estado.collections.some((c) => c.id === preferida)) {
    return preferida;
  }
  return estado.collections[0].id;
}

// addItem deduplica por URL dentro de la colección, también entre los propios
// ítems del lote porque el estado se va actualizando en cada iteración.
// La cola envuelve la secuencia completa (leer, añadir, escribir): sin ella,
// dos guardados concurrentes leerían el mismo estado y el segundo sobrescribiría
// al primero.
async function guardarItems(items) {
  return colaGuardado(async () => {
    let estado = await leerEstado();
    const collectionId = await idColeccionDestino(estado);
    for (const item of items) {
      estado = addItem(estado, collectionId, item);
    }
    await chrome.storage.local.set({ [STATE_STORAGE_KEY]: estado });
    return estado;
  });
}

// --- Extracción de contexto ----------------------------------------------

async function contextoDePestana(tabId) {
  if (!tabId) return null;
  try {
    const respuesta = await chrome.tabs.sendMessage(tabId, {
      type: "EXTRACT_CONTEXT",
    });
    if (!respuesta || typeof respuesta !== "object") return null;
    return respuesta.context && typeof respuesta.context === "object"
      ? respuesta.context
      : respuesta;
  } catch {
    // El extractor aún no está inyectado: se inyecta y se reintenta una vez.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/extractor.js"],
      });
      const respuesta = await chrome.tabs.sendMessage(tabId, {
        type: "EXTRACT_CONTEXT",
      });
      if (!respuesta || typeof respuesta !== "object") return null;
      return respuesta.context && typeof respuesta.context === "object"
        ? respuesta.context
        : respuesta;
    } catch {
      // Sin acceso a la pestaña se degrada a metadatos de chrome.tabs.
      return null;
    }
  }
}

function itemDesdeTab(tab, contexto, extra = {}) {
  const ctx = contexto || {};
  return buildCapturedItem({
    url: tab.url || ctx.url || "",
    title: tab.title || ctx.title || "",
    selection: ctx.selection || "",
    linkUrl: ctx.linkUrl || "",
    imageUrl: ctx.imageUrl || "",
    ogImage: ctx.ogImage || "",
    favicon: tab.favIconUrl || ctx.favicon || "",
    ...extra,
  });
}

// --- Acciones -------------------------------------------------------------

async function abrirPanel(windowId) {
  let id = windowId;
  if (!id) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    id = tab && tab.windowId;
  }
  if (!id) throw new Error("No se pudo determinar la ventana activa");
  await chrome.sidePanel.open({ windowId: id });
  return {};
}

async function pestanaActiva(tabId) {
  if (tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function guardarPagina(tabId) {
  const tab = await pestanaActiva(tabId);
  if (!tab || !isAbsoluteHttpUrl(tab.url)) {
    throw new Error("La pestaña activa no es una página http(s)");
  }
  const contexto = await contextoDePestana(tab.id);
  const item = itemDesdeTab(tab, contexto);
  await guardarItems([item]);
  return { items: [item] };
}

async function guardarTodasPestanas() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const items = tabs
    .filter((tab) => isAbsoluteHttpUrl(tab.url))
    // No se activan pestañas en segundo plano: solo metadatos de chrome.tabs.
    .map((tab) => itemDesdeTab(tab, null));
  await guardarItems(items);
  return { items };
}

async function inyectarBingScraper(tabId) {
  let id = tabId;
  if (!id) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    id = tab && tab.id;
  }
  if (!id) throw new Error("No se pudo determinar la pestaña de destino");
  await chrome.scripting.executeScript({
    target: { tabId: id },
    files: ["content/bing-saves.js"],
  });
  return { tabId: id };
}

// Dock de arrastre (Task 8/R5): se inyecta bajo demanda con el mismo patrón
// que el scraper de Bing. El content script es autoejecutable e idempotente.
async function inyectarDragDock(tabId) {
  let id = tabId;
  if (!id) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    id = tab && tab.id;
  }
  if (!id) throw new Error("No se pudo determinar la pestaña de destino");
  await chrome.scripting.executeScript({
    target: { tabId: id },
    files: ["content/drag-dock.js"],
  });
  return { tabId: id };
}

async function guardarDesdeDock(mensaje) {
  const tab = await pestanaActiva(mensaje.tabId);
  const ctx = mensaje.contexto && typeof mensaje.contexto === "object" ? mensaje.contexto : {};
  const seguro = (valor) => (isAbsoluteHttpUrl(valor) ? String(valor).trim() : "");
  const item = buildCapturedItem({
    url: seguro(ctx.url || (tab && tab.url) || ""),
    title: ctx.title || (tab && tab.title) || "",
    selection: ctx.selection || "",
    linkUrl: seguro(ctx.linkUrl),
    imageUrl: seguro(ctx.imageUrl),
    ogImage: seguro(ctx.ogImage),
    favicon: seguro(ctx.favicon || (tab && tab.favIconUrl) || ""),
  });
  await guardarItems([item]);
  return { items: [item] };
}

// Mutaciones pedidas por el panel. Todas pasan por la misma cola serializada
// que los guardados: el panel solo lee storage y delega aquí cada escritura.
// Se añaden casos nuevos sin modificar el comportamiento de los existentes.
const MUTACIONES = {
  createCollection: (estado, p) => createCollection(estado, p.name, p.extra),
  renameCollection: (estado, p) => renameCollection(estado, p.id, p.name),
  deleteCollection: (estado, p) => deleteCollection(estado, p.id),
  addItem: (estado, p) => addItem(estado, p.collectionId, p.item),
  updateItem: (estado, p) => updateItem(estado, p.itemId, p.patch),
  deleteItem: (estado, p) => deleteItem(estado, p.itemId),
  moveItem: (estado, p) => {
    const origen = estado.collections.find((c) =>
      c.items.some((i) => i.id === p.itemId)
    );
    let siguiente = moveItem(estado, p.itemId, p.targetCollectionId, p.index);
    if (origen) siguiente = renumberOrders(siguiente, origen.id);
    return renumberOrders(siguiente, p.targetCollectionId);
  },
  reorderItems: (estado, p) => renumberOrders(estado, p.collectionId, p.ids),
  createSection: (estado, p) => createSection(estado, p.collectionId, p.title),
  assignItemToSection: (estado, p) =>
    assignItemToSection(estado, p.itemId, p.sectionId),
  deleteSection: (estado, p) => {
    console.log("[colecciones] deleteSection recibido", p.sectionId);
    const resultado = deleteSection(estado, p.sectionId);
    console.log(
      "[colecciones] deleteSection resultado",
      resultado.collections.map((c) => `${c.name}:${(c.sections || []).length}`)
    );
    return resultado;
  },
  sortCollections: (estado, p) => sortCollections(estado, p.mode, p.direction),
  importCollections: (estado, p) => importIntoState(estado, p.collections),
  updateSettings: (estado, p) => {
    const patch = p.patch && typeof p.patch === "object" ? p.patch : {};
    const syncActual = (estado.settings && estado.settings.sync) || {};
    return {
      ...estado,
      settings: {
        ...estado.settings,
        ...patch,
        sync: { ...syncActual, ...(patch.sync || {}) },
      },
      updatedAt: Date.now(),
    };
  },
  replaceState: (estado, p) => migrate(p.state),
};

async function mutarEstado(mensaje) {
  const operacion = mensaje.op;
  if (!Object.hasOwn(MUTACIONES, operacion)) {
    throw new Error(`Operación no permitida: ${String(operacion)}`);
  }
  const payload = mensaje.payload && typeof mensaje.payload === "object" ? mensaje.payload : {};
  return colaGuardado(async () => {
    const estado = await leerEstado();
    const resultado = MUTACIONES[operacion](estado, payload);
    const siguiente = resultado && resultado.state ? resultado.state : resultado;
    await chrome.storage.local.set({ [STATE_STORAGE_KEY]: siguiente });
    return {
      state: siguiente,
      ...(resultado && resultado.stats ? { stats: resultado.stats } : {}),
    };
  });
}

async function guardarDesdeMenu(info, tab) {
  const contexto = await contextoDePestana(tab && tab.id);
  const srcUrl = info.mediaType === "image" ? info.srcUrl || "" : "";
  const item = itemDesdeTab(tab || {}, contexto, {
    selection: info.selectionText || (contexto && contexto.selection) || "",
    linkUrl: info.linkUrl || (contexto && contexto.linkUrl) || "",
    imageUrl: srcUrl || (contexto && contexto.imageUrl) || "",
  });
  if (info.menuItemId === MENU.citation) item.annotation = "Cita";
  await guardarItems([item]);
  return { items: [item] };
}

// --- Registro -------------------------------------------------------------

async function configurarPanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Algunas versiones anteriores a Chromium 114 no exponen setPanelBehavior.
  }
}

configurarPanel();

chrome.runtime.onInstalled.addListener(async () => {
  await configurarPanel();
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU.save,
    title: "Guardar en Colecciones",
    contexts: ["page", "link", "image", "selection", "frame"],
  });
  chrome.contextMenus.create({
    id: MENU.note,
    title: "Guardar selección como nota",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: MENU.citation,
    title: "Guardar selección como cita",
    contexts: ["selection"],
  });
});

// Los documentos offscreen desaparecen al apagar el navegador. Si la sync
// estaba activa se recrea al arrancar (o al instalar) sin abrir el panel.
async function asegurarSyncAlArrancar() {
  try {
    const estado = await leerEstado();
    if (!estado.settings || !estado.settings.sync || !estado.settings.sync.enabled) return;
    await asegurarDocumentoOffscreen();
    chrome.runtime.sendMessage({ type: "SYNC_START" }, () => void chrome.runtime.lastError);
  } catch {
    // Sin estado leíble no se intenta arrancar la sincronización.
  }
}

chrome.runtime.onStartup.addListener(asegurarSyncAlArrancar);
chrome.runtime.onInstalled.addListener(asegurarSyncAlArrancar);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!Object.values(MENU).includes(info.menuItemId)) return;
  guardarDesdeMenu(info, tab).catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-panel" || command === "open-panel-alt") {
    abrirPanel().catch(() => {});
  } else if (command === "quick-save") {
    guardarPagina().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((mensaje, remitente, responder) => {
  if (!mensaje) return false;
  const tabId = mensaje.tabId || (remitente.tab && remitente.tab.id);

  switch (mensaje.type) {
    case "OPEN_PANEL":
      return responderAsync(
        () => abrirPanel(mensaje.windowId || (remitente.tab && remitente.tab.windowId)),
        responder
      );
    case "SAVE_PAGE":
      return responderAsync(() => guardarPagina(tabId), responder);
    case "SAVE_ALL_TABS":
      return responderAsync(guardarTodasPestanas, responder);
    case "INJECT_BING_SCRAPER":
      // Hook usado por Task 9: este archivo no debe modificarse para ello.
      return responderAsync(() => inyectarBingScraper(tabId), responder);
    case "INJECT_DRAG_DOCK":
      // R5: inyección bajo demanda del dock de arrastre en la pestaña activa.
      return responderAsync(() => inyectarDragDock(tabId), responder);
    case "DOCK_DROP":
      return responderAsync(() => guardarDesdeDock({ ...mensaje, tabId }), responder);
    case "MUTATE_STATE":
      return responderAsync(() => mutarEstado(mensaje), responder);
    case "SYNC_GET_STATE":
      // El documento offscreen solo tiene acceso a chrome.runtime: el estado
      // se le entrega en `state` (no disperso en la respuesta), sin escribir.
      return responderAsync(async () => ({ state: await leerEstado() }), responder);
    default:
      return false;
  }
});

function responderAsync(accion, responder) {
  Promise.resolve()
    .then(accion)
    .then((resultado) => responder({ ok: true, ...(resultado || {}) }))
    .catch((error) =>
      responder({ ok: false, error: String((error && error.message) || error) })
    );
  return true;
}
