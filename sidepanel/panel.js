// sidepanel/panel.js — UI del panel lateral y orquestación.
// El panel SOLO lee chrome.storage.local. Toda escritura se delega al service
// worker mediante MUTATE_STATE para que use la cola serializada del Task 7.
import {
  STATE_STORAGE_KEY,
  isAbsoluteHttpUrl,
  thumbnailCandidates,
} from "../lib/capture.js";
import {
  createEmptyState,
  deleteSection,
  migrate,
  partitionItemsBySection,
  previewImport,
} from "../lib/store.js";
import { mapEdgeCsv } from "../lib/csv.js";
import { normalizeBingPayload } from "../lib/bingsaves.js";
import { parseJsonBackup, toCsv, toJsonBackup } from "../lib/export.js";
import { buildXlsx } from "../lib/xlsx.js";
import { toHtml, toLinkList, toMarkdown } from "../lib/render.js";
import { t } from "../lib/i18n.js";
import { asegurarDocumentoOffscreen } from "../offscreen/offscreen.js";

const $ = (id) => document.getElementById(id);
const refs = {
  title: $("view-title"),
  back: $("back-btn"),
  menuBtn: $("menu-btn"),
  menu: $("menu"),
  lista: $("list-view"),
  detalle: $("detail-view"),
  collections: $("collections-list"),
  items: $("items-list"),
  nuevaColeccion: $("new-collection"),
  renombrar: $("rename-collection"),
  anadirSeccion: $("add-section"),
  abrirTodo: $("open-all"),
  borrarColeccion: $("delete-collection"),
  dialog: $("dialog"),
  dialogContent: $("dialog-content"),
  toast: $("toast"),
  csv: $("file-csv"),
  json: $("file-json"),
  sqlite: $("file-sqlite"),
  sync: $("file-sync"),
  moveTargets: $("move-targets"),
};

let estado = createEmptyState();
let coleccionActivaId = null;
let arrastrandoId = null;
let dialogoConflictoAbierto = false;
let conflictoMostradoAt = null;
let pendingBing = null;
let debugBing = [];
let temporizadorBing = null;
const BING_IMPORT_TIMEOUT_MS = 90000;
let modoJson = "import";
let temporizadorToast = null;

// --- Utilidades DOM -------------------------------------------------------

function el(etiqueta, propiedades = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(propiedades)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === "text") nodo.textContent = String(valor);
    else if (clave === "class") nodo.className = String(valor);
    else if (clave === "value") nodo.value = valor;
    else if (clave === "checked") nodo.checked = Boolean(valor);
    else if (clave.startsWith("on") && typeof valor === "function") {
      nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave === "dataset") Object.assign(nodo.dataset, valor);
    else nodo.setAttribute(clave, valor === true ? "" : String(valor));
  }
  for (const hijo of hijos) if (hijo) nodo.append(hijo);
  return nodo;
}

function mostrarToast(mensaje) {
  refs.toast.textContent = mensaje;
  refs.toast.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => {
    refs.toast.hidden = true;
  }, 2600);
}

function cerrarDialogo() {
  dialogoConflictoAbierto = false;
  if (refs.dialog.open) refs.dialog.close();
}

function mostrarDialogo(titulo, contenido, botones = []) {
  const cuerpo = el(
    "div",
    {},
    el("h2", { text: titulo }),
    typeof contenido === "string" ? el("p", { text: contenido }) : contenido
  );
  const fila = el("div", { class: "botones" });
  const lista = botones.length
    ? botones
    : [{ texto: t("common.close"), accion: cerrarDialogo }];
  for (const boton of lista) {
    fila.append(
      el("button", {
        type: "button",
        class: boton.primario ? "primario" : "",
        text: boton.texto,
        onclick: boton.accion,
      })
    );
  }
  cuerpo.append(fila);
  refs.dialogContent.replaceChildren(cuerpo);
  if (!refs.dialog.open) refs.dialog.showModal();
}

function campo(nombre, etiqueta, opciones = {}) {
  const tipo = opciones.tipo || "text";
  let control;
  if (tipo === "select") {
    control = el(
      "select",
      {},
      ...(opciones.opciones || []).map((opcion) =>
        el("option", {
          value: opcion.valor,
          text: opcion.texto,
          selected: opcion.valor === opciones.valor,
        })
      )
    );
  } else if (tipo === "textarea") {
    control = el("textarea", { text: opciones.valor || "" });
  } else {
    control = el("input", { type: tipo, value: opciones.valor || "" });
  }
  control.dataset.campo = nombre;
  return el("div", {}, el("label", { text: etiqueta }), control);
}

function dialogoFormulario({ titulo, campos, extra = [], aceptar, textoAceptar }) {
  const cuerpo = el("div", {}, ...extra, ...campos);
  const tomarValores = () => {
    const valores = {};
    cuerpo.querySelectorAll("[data-campo]").forEach((nodo) => {
      valores[nodo.dataset.campo] = nodo.value;
    });
    return valores;
  };
  mostrarDialogo(titulo, cuerpo, [
    { texto: t("common.cancel"), accion: cerrarDialogo },
    {
      texto: textoAceptar || t("common.save"),
      primario: true,
      accion: async () => {
        try {
          await aceptar(tomarValores());
        } catch (error) {
          mostrarToast(String(error && error.message) || t("common.error"));
        }
      },
    },
  ]);
}

// --- Estado y mutaciones --------------------------------------------------

function enviarMensaje(mensaje) {
  return new Promise((resolver) => {
    chrome.runtime.sendMessage(mensaje, (respuesta) => {
      void chrome.runtime.lastError;
      resolver(respuesta);
    });
  });
}

async function verificar(respuesta) {
  if (!respuesta || !respuesta.ok) {
    throw new Error((respuesta && respuesta.error) || t("common.error"));
  }
  return respuesta;
}

async function leerEstado() {
  const guardado = await chrome.storage.local.get(STATE_STORAGE_KEY);
  estado = migrate(guardado && guardado[STATE_STORAGE_KEY]);
  if (
    coleccionActivaId &&
    !estado.collections.some((c) => c.id === coleccionActivaId)
  ) {
    coleccionActivaId = null;
  }
  aplicarTema();
  renderizar();
  // Tras reiniciar el navegador el documento offscreen desaparece: al volver a
  // abrir el panel se reanuda el bombeo de una sincronización ya activada.
  if (estado.settings && estado.settings.sync && estado.settings.sync.enabled) {
    await asegurarDocumentoOffscreen();
    chrome.runtime.sendMessage({ type: "SYNC_START" }, () => void chrome.runtime.lastError);
    // Sync puede ocurrir con el panel cerrado: al volver se recupera el aviso
    // pendiente de IndexedDB, no solo el mensaje en vivo del documento offscreen.
    await revisarConflictoPendiente();
  }
}

async function mutar(operacion, payload = {}) {
  try {
    const respuesta = await verificar(
      await enviarMensaje({ type: "MUTATE_STATE", op: operacion, payload })
    );
    estado = migrate(respuesta.state);
    aplicarTema();
    renderizar();
    return respuesta;
  } catch (error) {
    // Antes estos fallos quedaban como promesas rechazadas silenciosas: la
    // interfaz parecía no reaccionar sin explicación.
    mostrarToast(String(error && error.message) || t("common.error"));
    throw error;
  }
}

function aplicarTema() {
  const tema = estado.settings && estado.settings.theme;
  document.documentElement.dataset.theme =
    tema === "light" || tema === "dark" ? tema : "system";
}

function coleccionActiva() {
  return estado.collections.find((c) => c.id === coleccionActivaId) || null;
}

async function coleccionDestino() {
  const activa = coleccionActiva();
  if (activa) return activa.id;
  const preferida = estado.settings && estado.settings.defaultCollectionId;
  if (preferida && estado.collections.some((c) => c.id === preferida)) {
    return preferida;
  }
  if (estado.collections.length) return estado.collections[0].id;
  const respuesta = await mutar("createCollection", { name: t("collection.new") });
  return respuesta.state.collections[respuesta.state.collections.length - 1].id;
}

// --- Render ---------------------------------------------------------------

function urlSegura(valor) {
  return isAbsoluteHttpUrl(valor) ? String(valor).trim() : "";
}

function dominioDe(valor) {
  try {
    return new URL(valor).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function ordenarItems(items) {
  const lista = Array.isArray(items) ? items : [];
  return lista
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ao = Number.isFinite(a.item.order) ? a.item.order : Infinity;
      const bo = Number.isFinite(b.item.order) ? b.item.order : Infinity;
      return ao - bo || a.index - b.index;
    })
    .map((entrada) => entrada.item);
}

function crearMiniatura(item, clase = "thumb") {
  const candidatos = thumbnailCandidates(item);
  if (!candidatos.length) {
    return el("span", { class: "enlace-icono", text: "🔗" });
  }
  const imagen = el("img", { class: clase, alt: "", loading: "lazy" });
  let indice = 0;
  imagen.addEventListener("error", () => {
    indice += 1;
    if (indice < candidatos.length) {
      imagen.src = candidatos[indice];
    } else {
      // Último recurso: la tarjeta sigue siendo un enlace perfectamente
      // legible aunque todas las imágenes estén caducas (Review Focus #3).
      const tarjeta = imagen.closest(".tarjeta");
      imagen.remove();
      if (tarjeta) tarjeta.classList.add("sin-miniatura");
    }
  });
  imagen.src = candidatos[0];
  return imagen;
}

// El id viaja en dataTransfer para arrastres dentro del panel; `arrastrandoId`
// cubre navegadores que no exponen getData durante dragover.
function idArrastrado(evento) {
  const id =
    arrastrandoId || (evento.dataTransfer && evento.dataTransfer.getData("text/plain"));
  return estado.collections.some((c) => (c.items || []).some((i) => i.id === id)) ? id : null;
}

function crearTarjeta(item) {
  const tarjeta = el("article", { class: "tarjeta", draggable: "true" });
  tarjeta.dataset.id = item.id;
  const candidatos = thumbnailCandidates(item);
  if (!candidatos.length) tarjeta.classList.add("sin-miniatura");
  const miniatura = crearMiniatura(item);
  tarjeta.append(miniatura);
  if (candidatos.length) {
    const icono = el("span", { class: "enlace-icono", text: "🔗" });
    tarjeta.append(icono);
  }

  const destino = urlSegura(item.url);
  const titulo = el("a", {
    class: "titulo",
    text: item.title || item.text?.slice(0, 80) || t("app.title"),
    href: destino || "#",
    target: destino ? "_blank" : null,
    rel: destino ? "noopener noreferrer" : null,
  });
  if (!destino) titulo.addEventListener("click", (evento) => evento.preventDefault());

  const cuerpo = el(
    "div",
    { class: "cuerpo" },
    titulo,
    el("div", { class: "dominio", text: dominioDe(item.url || item.sourceUrl || "") })
  );
  if (item.type === "note" || item.type === "text") {
    cuerpo.append(el("p", { class: "texto", text: item.text || "" }));
  }
  const acciones = el(
    "div",
    { class: "acciones" },
    el("button", {
      type: "button",
      text: t("card.open"),
      onclick: async () => {
        if (destino) await chrome.tabs.create({ url: destino });
      },
    }),
    el("button", {
      type: "button",
      text: t("card.copy"),
      onclick: async () => {
        if (destino) {
          await navigator.clipboard.writeText(destino);
          mostrarToast(t("export.copy.done"));
        }
      },
    }),
    el("button", { type: "button", text: t("card.edit"), onclick: () => editarItem(item) }),
    el("button", {
      type: "button",
      class: "peligro",
      text: t("card.delete"),
      onclick: async () => {
        mostrarDialogo(t("card.delete"), item.title || t("app.title"), [
          { texto: t("common.cancel"), accion: cerrarDialogo },
          {
            texto: t("card.delete"),
            primario: true,
            accion: async () => {
              await mutar("deleteItem", { itemId: item.id });
              cerrarDialogo();
            },
          },
        ]);
      },
    })
  );
  cuerpo.append(acciones);
  tarjeta.append(cuerpo);

  // Reordenado HTML5 nativo: mismo WebContents (el panel).
  tarjeta.addEventListener("dragstart", (evento) => {
    arrastrandoId = item.id;
    tarjeta.classList.add("arrastrando");
    // La barra de destinos permite soltar sobre otra colección sin salir de la
    // vista de detalle (la lista de colecciones está oculta mientras se arrastra).
    refs.moveTargets.hidden = !refs.moveTargets.childElementCount;
    if (evento.dataTransfer) {
      evento.dataTransfer.effectAllowed = "move";
      evento.dataTransfer.setData("text/plain", item.id);
    }
  });
  tarjeta.addEventListener("dragend", () => {
    arrastrandoId = null;
    tarjeta.classList.remove("arrastrando");
    refs.moveTargets.hidden = true;
    document
      .querySelectorAll(".tarjeta.destino, .coleccion.destino, .destino-coleccion.destino, .seccion-titulo.destino")
      .forEach((n) => n.classList.remove("destino"));
  });
  tarjeta.addEventListener("dragover", (evento) => {
    evento.preventDefault();
    tarjeta.classList.add("destino");
  });
  tarjeta.addEventListener("dragleave", () => tarjeta.classList.remove("destino"));
  tarjeta.addEventListener("drop", async (evento) => {
    evento.preventDefault();
    tarjeta.classList.remove("destino");
    const origen = arrastrandoId || evento.dataTransfer?.getData("text/plain");
    const col = coleccionActiva();
    if (!col || !origen || origen === item.id) return;
    const ids = ordenarItems(col.items).map((i) => i.id);
    const desde = ids.indexOf(origen);
    if (desde < 0) return;
    ids.splice(desde, 1);
    ids.splice(ids.indexOf(item.id), 0, origen);
    arrastrandoId = null;
    await mutar("reorderItems", { collectionId: col.id, ids });
  });
  return tarjeta;
}

function renderizar() {
  const col = coleccionActiva();
  refs.lista.hidden = Boolean(col);
  refs.detalle.hidden = !col;
  refs.back.hidden = !col;
  refs.title.textContent = col ? col.name : t("app.title");
  if (col) renderizarDetalle(col);
  else renderizarLista();
}

function renderizarLista() {
  refs.collections.replaceChildren();
  if (!estado.collections.length) {
    refs.collections.append(el("p", { class: "vacio", text: t("collection.empty") }));
    return;
  }
  for (const col of estado.collections) {
    const ordenados = ordenarItems(col.items);
    const primero = ordenados.find((i) => thumbnailCandidates(i).length) || ordenados[0];
    const miniatura = primero
      ? crearMiniatura(primero, "miniatura")
      : el("span", { class: "miniatura", text: (col.name || "?").slice(0, 1) });
    const boton = el(
      "button",
      {
        type: "button",
        class: "coleccion",
        onclick: () => {
          coleccionActivaId = col.id;
          renderizar();
        },
      },
      miniatura,
      el("span", { class: "nombre", text: col.name }),
      el("span", { class: "conteo", text: String((col.items || []).length) })
    );
    // Soltar una tarjeta sobre otra colección la mueve (MUTATE_STATE).
    boton.addEventListener("dragover", (evento) => {
      if (!idArrastrado(evento)) return;
      evento.preventDefault();
      boton.classList.add("destino");
    });
    boton.addEventListener("dragleave", () => boton.classList.remove("destino"));
    boton.addEventListener("drop", async (evento) => {
      evento.preventDefault();
      boton.classList.remove("destino");
      const itemId = idArrastrado(evento);
      const origen = estado.collections.find((c) =>
        (c.items || []).some((i) => i.id === itemId)
      );
      if (!itemId || !origen || origen.id === col.id) return;
      arrastrandoId = null;
      await mutar("moveItem", { itemId, targetCollectionId: col.id });
    });
    refs.collections.append(boton);
  }
}

function renderizarDetalle(col) {
  refs.items.replaceChildren();
  const { sections, sinSeccion } = partitionItemsBySection(col);

  // Destinos de colección visibles solo mientras se arrastra una tarjeta.
  refs.moveTargets.replaceChildren();
  refs.moveTargets.hidden = true;
  const otros = estado.collections.filter((c) => c.id !== col.id);
  if (otros.length) {
    refs.moveTargets.append(el("span", { class: "move-targets-label", text: t("move.targets") }));
  }
  for (const destino of otros) {
    const boton = el("button", {
      type: "button",
      class: "destino-coleccion",
      text: destino.name,
      dataset: { collectionId: destino.id },
    });
    boton.addEventListener("dragover", (evento) => {
      if (!idArrastrado(evento)) return;
      evento.preventDefault();
      boton.classList.add("destino");
    });
    boton.addEventListener("dragleave", () => boton.classList.remove("destino"));
    boton.addEventListener("drop", async (evento) => {
      evento.preventDefault();
      boton.classList.remove("destino");
      const itemId = idArrastrado(evento);
      if (!itemId || !col.items.some((i) => i.id === itemId)) return;
      arrastrandoId = null;
      await mutar("moveItem", { itemId, targetCollectionId: destino.id });
    });
    refs.moveTargets.append(boton);
  }

  const pintar = (titulo, lista, section = null) => {
    if (titulo) {
      const cabecera = el("h2", { class: "seccion-titulo", text: titulo });
      if (section) {
        cabecera.dataset.sectionId = section.id;
        cabecera.addEventListener("dragover", (evento) => {
          if (!idArrastrado(evento)) return;
          evento.preventDefault();
          cabecera.classList.add("destino");
        });
        cabecera.addEventListener("dragleave", () => cabecera.classList.remove("destino"));
        cabecera.addEventListener("drop", async (evento) => {
          evento.preventDefault();
          cabecera.classList.remove("destino");
          const itemId = idArrastrado(evento);
          if (!itemId || !col.items.some((i) => i.id === itemId)) return;
          arrastrandoId = null;
          await mutar("assignItemToSection", { itemId, sectionId: section.id });
        });
        const borrar = el("button", {
          type: "button",
          class: "seccion-eliminar",
          text: "×",
          title: t("section.delete"),
        });
        borrar.addEventListener("click", (evento) => {
          evento.stopPropagation();
          mostrarDialogo(
            t("section.delete"),
            el("p", { text: t("section.deleteConfirm", { name: titulo }) }),
            [
              { texto: t("common.cancel"), accion: cerrarDialogo },
              {
                texto: t("common.delete"),
                primario: true,
                accion: async () => {
                  cerrarDialogo();
                  // Se calcula el estado nuevo en el panel y se envía con
                  // replaceState: así funciona aunque el service worker en
                  // ejecución sea una versión anterior que no conozca
                  // todavía la operación deleteSection.
                  await mutar("replaceState", {
                    state: deleteSection(estado, section.id),
                  });
                },
              },
            ]
          );
        });
        cabecera.append(borrar);
      }
      refs.items.append(cabecera);
    }
    for (const item of lista) refs.items.append(crearTarjeta(item));
  };
  pintar("", sinSeccion);
  for (const { section, items } of sections) pintar(section.title, items, section);
  if (!sinSeccion.length && !sections.length) {
    refs.items.append(el("p", { class: "vacio", text: t("items.empty") }));
  }
}

// --- Diálogos de importación ---------------------------------------------

function dialogoVistaPrevia(titulo, collections, extra = []) {
  if (!collections.length) {
    mostrarDialogo(titulo, t("items.empty"));
    return;
  }
  const vista = previewImport(estado, collections);
  const cuerpo = el(
    "div",
    {},
    ...extra,
    el("p", { text: t("import.preview", { n: vista.collections, m: vista.items }) })
  );
  if (vista.skipped) {
    cuerpo.append(
      el("p", { class: "progreso", text: t("import.skipped", { n: vista.skipped }) })
    );
  }
  mostrarDialogo(titulo, cuerpo, [
    { texto: t("common.cancel"), accion: cerrarDialogo },
    {
      texto: t("import.confirm"),
      primario: true,
      accion: async () => {
        try {
          await mutar("importCollections", { collections });
          cerrarDialogo();
          mostrarToast(t("import.done"));
        } catch (error) {
          mostrarToast(String(error && error.message) || t("common.error"));
        }
      },
    },
  ]);
}

function importarCsv() {
  // Review Focus #2: el aviso se muestra ANTES de elegir el archivo y antes
  // de cualquier confirmación de importación.
  mostrarDialogo("Importar CSV", el("p", { class: "aviso", text: t("import.csv.notice") }), [
    { texto: t("common.cancel"), accion: cerrarDialogo },
    { texto: t("import.chooseFile"), primario: true, accion: () => refs.csv.click() },
  ]);
}

refs.csv.addEventListener("change", async (evento) => {
  const archivo = evento.target.files && evento.target.files[0];
  evento.target.value = "";
  if (!archivo) return;
  try {
    const mapeado = mapEdgeCsv(await archivo.text());
    const extra = [el("p", { class: "aviso", text: t("import.csv.notice") })];
    if (mapeado.stats.skipped) {
      extra.push(
        el("p", { class: "progreso", text: t("import.skipped", { n: mapeado.stats.skipped }) })
      );
    }
    dialogoVistaPrevia("Importar CSV", mapeado.collections, extra);
  } catch (error) {
    mostrarDialogo("Importar CSV", t("common.error"));
  }
});

function esperarCarga(tabId) {
  return new Promise((resolver) => {
    let terminado = false;
    const temporizador = setTimeout(finalizar, 15000);
    function finalizar() {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      chrome.tabs.onUpdated.removeListener(escuchar);
      resolver();
    }
    function escuchar(id, info) {
      if (id === tabId && info.status === "complete") finalizar();
    }
    chrome.tabs.onUpdated.addListener(escuchar);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === "complete") finalizar();
    }).catch(finalizar);
  });
}

function limpiarBing() {
  if (temporizadorBing !== null) {
    clearTimeout(temporizadorBing);
    temporizadorBing = null;
  }
  pendingBing = null;
}

// Cancela la espera sin dejar el guardia `pendingBing` activo: de lo contrario
// la importación quedaría colgada y bloquearía los reintentos (Review round 1).
function cancelarBing() {
  const actual = pendingBing;
  limpiarBing();
  if (actual) actual.resolver(null);
  cerrarDialogo();
}

// Fallo acotado (timeout o error al inyectar): limpia el guardia y el timer,
// resuelve la promesa con null, cierra el diálogo de progreso y ofrece reintentar.
function fallarBing(mensaje) {
  const actual = pendingBing;
  if (!actual) return;
  limpiarBing();
  actual.resolver(null);
  cerrarDialogo();
  mostrarDialogo("Bing Saves", el("p", { text: mensaje }), [
    { texto: t("common.close"), accion: cerrarDialogo },
    { texto: t("import.retry"), primario: true, accion: () => importarBing() },
  ]);
}

async function importarBing() {
  if (pendingBing) return;
  const progreso = el("p", {
    class: "progreso",
    text: t("import.bing.progress", { name: "…", current: 0, total: 0 }),
  });
  mostrarDialogo("Bing Saves", progreso, [
    { texto: t("common.cancel"), accion: cancelarBing },
  ]);
  try {
    const tab = await chrome.tabs.create({ url: "https://www.bing.com/saves", active: true });
    await esperarCarga(tab.id);
    const payload = await new Promise((resolver) => {
      pendingBing = { tabId: tab.id, resolver, progreso, iniciado: Date.now() };
      temporizadorBing = setTimeout(
        () => fallarBing(t("import.bing.timeout")),
        BING_IMPORT_TIMEOUT_MS
      );
      chrome.runtime.sendMessage(
        { type: "INJECT_BING_SCRAPER", tabId: tab.id },
        (respuesta) => {
          void chrome.runtime.lastError;
          if (!respuesta || !respuesta.ok) fallarBing(t("import.bing.login"));
        }
      );
    });

    if (!payload) return; // El error ya se mostró (timeout, cancelación o inyección).
    if (payload.error) {
      mostrarDialogo(
        "Bing Saves",
        payload.error === "PARSE_ERROR" || payload.error === "EMPTY_RESULT"
          ? t("import.bing.parseError", { detail: payload.detalle || payload.error })
          : t("import.bing.login")
      );
      return;
    }
    const normalizado = normalizeBingPayload(payload);
    if (!normalizado.collections.length) {
      mostrarDialogo("Bing Saves", el("p", { class: "aviso", text: t("import.bing.empty") }));
      return;
    }
    const extra = [];
    if (normalizado.stats.skipped) {
      extra.push(
        el("p", {
          class: "progreso",
          text: t("import.skipped", { n: normalizado.stats.skipped }),
        })
      );
    }
    dialogoVistaPrevia("Bing Saves", normalizado.collections, extra);
  } catch {
    limpiarBing();
    mostrarDialogo("Bing Saves", t("common.error"));
  }
}

chrome.runtime.onMessage.addListener((mensaje) => {
  if (mensaje && mensaje.type === "BING_DEBUG") {
    debugBing.push({ etapa: mensaje.etapa, datos: mensaje.datos, en: Date.now() });
    return false;
  }
  if (!pendingBing || !mensaje) return false;
  if (mensaje.type === "BING_PROGRESS") {
    pendingBing.progreso.textContent = t("import.bing.progress", {
      name: mensaje.name || "…",
      current: mensaje.current ?? 0,
      total: mensaje.total ?? 0,
    });
    return false;
  }
  if (mensaje.type === "BING_RESULT") {
    // WRONG_PAGE / sin sesión: el scraper envía payload nulo. Hay que limpiar,
    // cerrar el progreso y explicarlo; resolver null sin más deja el diálogo colgado.
    if (!mensaje.payload) {
      fallarBing(t("import.bing.login"));
      return false;
    }
    const actual = pendingBing;
    limpiarBing();
    actual.resolver(mensaje.payload);
    return false;
  }
  return false;
});

// El conflicto se decide en el panel: el documento offscreen deja el archivo
// remoto intacto y solo informa. La copia también se recupera al abrir el panel.
chrome.runtime.onMessage.addListener((mensaje) => {
  if (!mensaje) return false;
  if (mensaje.type === "SYNC_CONFLICT") {
    mostrarConflictoSync({ remoteText: mensaje.remoteText, at: mensaje.at });
  }
  return false;
});

// Si el navegador revoca el permiso sobre el archivo, el documento offscreen
// no puede abrir un selector (requiere ventana y gesto): se lo pedimos al
// usuario desde el panel, donde sí puede elegirlo de nuevo.
chrome.runtime.onMessage.addListener((mensaje) => {
  if (!mensaje || mensaje.type !== "SYNC_PERMISSION_LOST") return false;
  mostrarDialogo(
    "Sincronización por archivo",
    "El navegador ha revocado el permiso sobre el archivo de sincronización. Vuelve a elegirlo para continuar.",
    [
      { texto: t("common.close"), accion: cerrarDialogo },
      {
        texto: t("import.chooseFile"),
        primario: true,
        accion: async () => {
          cerrarDialogo();
          await activarSync();
        },
      },
    ]
  );
  return false;
});

refs.sqlite.addEventListener("change", async (evento) => {
  const archivo = evento.target.files && evento.target.files[0];
  evento.target.value = "";
  if (!archivo) return;
  const titulo = t("import.sqlite.title");
  try {
    const modulo = await import("../lib/sqlite.js");
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const resultado = modulo.readCollectionsSqlite(bytes);
    if (!resultado.collections.length) {
      mostrarDialogo(titulo, t("import.sqlite.empty"));
      return;
    }
    const extra = [
      el("p", {
        class: "progreso",
        text: t("import.sqlite.summary", {
          notes: resultado.stats.notes || 0,
          images: resultado.stats.images || 0,
        }),
      }),
    ];
    dialogoVistaPrevia(titulo, resultado.collections, extra);
  } catch (error) {
    const motivo = error && error.message;
    const mensaje =
      motivo === "NOT_A_SQLITE_DB"
        ? t("import.sqlite.invalid")
        : motivo === "SQLITE_CORRUPT" || motivo === "SQLITE_UNSUPPORTED"
          ? t("import.sqlite.corrupt")
          : t("import.sqlite.error");
    mostrarDialogo(titulo, mensaje);
  }
});

function importarJson() {
  modoJson = "import";
  refs.json.click();
}

refs.json.addEventListener("change", async (evento) => {
  const archivo = evento.target.files && evento.target.files[0];
  evento.target.value = "";
  if (!archivo) return;
  try {
    const copia = parseJsonBackup(await archivo.text());
    if (modoJson === "restore") {
      mostrarDialogo(t("settings.restore"), t("import.preview", {
        n: (copia.collections || []).length,
        m: (copia.collections || []).reduce(
          (suma, col) => suma + (Array.isArray(col.items) ? col.items.length : 0),
          0
        ),
      }), [
        { texto: t("common.cancel"), accion: cerrarDialogo },
        {
          texto: t("common.save"),
          primario: true,
          accion: async () => {
            try {
              await mutar("replaceState", { state: copia });
              coleccionActivaId = null;
              cerrarDialogo();
              mostrarToast(t("settings.saved"));
            } catch (error) {
              mostrarToast(String(error && error.message) || t("common.error"));
            }
          },
        },
      ]);
    } else {
      dialogoVistaPrevia("JSON", copia.collections || []);
    }
  } catch {
    mostrarDialogo("JSON", t("import.json.invalid"));
  }
});

// --- Exportación ---------------------------------------------------------

function descargar(nombre, contenido, tipo) {
  const bytes = contenido instanceof Uint8Array ? contenido : new TextEncoder().encode(contenido);
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const limpio = String(nombre).replace(/[^\p{L}\p{N}._-]+/gu, "_");
  chrome.downloads.download({ url, filename: limpio, saveAs: false }, () => {
    void chrome.runtime.lastError;
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  mostrarToast(t("export.done"));
}

async function exportar(formato) {
  const colecciones = estado.collections;
  const fecha = new Date().toISOString().slice(0, 10);
  switch (formato) {
    case "csv":
      descargar(`colecciones-${fecha}.csv`, toCsv(colecciones), "text/csv;charset=utf-8");
      break;
    case "markdown":
      descargar(`colecciones-${fecha}.md`, toMarkdown(colecciones), "text/markdown;charset=utf-8");
      break;
    case "html":
      descargar(`colecciones-${fecha}.html`, toHtml(colecciones), "text/html;charset=utf-8");
      break;
    case "json":
      descargar(`colecciones-${fecha}.json`, toJsonBackup(estado), "application/json");
      break;
    case "xlsx":
      descargar(
        `colecciones-${fecha}.xlsx`,
        buildXlsx(colecciones),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      break;
    case "copy":
      try {
        await navigator.clipboard.writeText(toLinkList(colecciones));
        mostrarToast(t("export.copy.done"));
      } catch {
        mostrarToast(t("common.error"));
      }
      break;
    default:
      break;
  }
}

// --- Ajustes y sincronización --------------------------------------------

function abrirBase() {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open("colecciones", 1);
    peticion.onupgradeneeded = () => {
      if (!peticion.result.objectStoreNames.contains("handles")) {
        peticion.result.createObjectStore("handles");
      }
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

async function guardarHandleSync(handle) {
  const base = await abrirBase();
  return new Promise((resolver, rechazar) => {
    const transaccion = base.transaction("handles", "readwrite");
    transaccion.objectStore("handles").put(handle, "sync");
    transaccion.oncomplete = () => {
      base.close();
      resolver();
    };
    transaccion.onerror = () => {
      base.close();
      rechazar(transaccion.error);
    };
  });
}

async function leerDatoSync(clave) {
  const base = await abrirBase();
  return new Promise((resolver, rechazar) => {
    const peticion = base
      .transaction("handles", "readonly")
      .objectStore("handles")
      .get(clave);
    peticion.onsuccess = () => {
      base.close();
      resolver(peticion.result);
    };
    peticion.onerror = () => {
      base.close();
      rechazar(peticion.error);
    };
  });
}

function mostrarConflictoSync(conflicto) {
  if (!conflicto || dialogoConflictoAbierto) return;
  if (conflicto.at && conflictoMostradoAt === conflicto.at) return;
  dialogoConflictoAbierto = true;
  conflictoMostradoAt = conflicto.at ?? null;
  const fecha = conflicto.at ? new Date(conflicto.at).toLocaleString() : "";
  const cuerpo = el(
    "div",
    {},
    el("p", { class: "aviso", text: t("sync.conflict.message") }),
    el("p", {
      class: "progreso",
      text: fecha
        ? `${t("sync.conflict.remote")} · ${fecha}`
        : t("sync.conflict.remote"),
    }),
    el("pre", {
      class: "copia-sync",
      text: conflicto.remoteText || conflicto.texto || t("sync.backup.empty"),
    })
  );
  mostrarDialogo(t("sync.conflict.title"), cuerpo, [
    {
      texto: t("common.cancel"),
      accion: () => {
        cerrarDialogo();
        mostrarToast(t("sync.conflict.deferred"));
      },
    },
    {
      texto: t("sync.conflict.overwrite"),
      primario: true,
      accion: async () => {
        try {
          await verificar(
            await enviarMensaje({ type: "SYNC_RESOLVE_CONFLICT", confirm: true })
          );
          cerrarDialogo();
          mostrarToast(t("sync.conflict.resolved"));
        } catch (error) {
          mostrarToast(String(error && error.message) || t("common.error"));
        }
      },
    },
  ]);
}

async function revisarConflictoPendiente() {
  try {
    const copia = await leerDatoSync("sync-backup");
    if (copia && copia.pendiente === true) {
      mostrarConflictoSync({ remoteText: copia.texto, at: copia.at });
    }
  } catch {
    // Sin IndexedDB el panel sigue siendo plenamente local; solo se pierde el aviso.
  }
}

async function activarSync() {
  if (typeof window.showOpenFilePicker !== "function") {
    mostrarDialogo(t("settings.sync"), t("settings.sync.hint"));
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "Copia de sincronización",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    await guardarHandleSync(handle);
    await mutar("updateSettings", {
      patch: { sync: { enabled: true, fileHandleName: handle.name } },
    });
    // El selector se abrió aquí (ventana + gesto); el handle vive en IndexedDB
    // y el documento offscreen hereda el bombeo cuando el panel se cierra.
    await asegurarDocumentoOffscreen();
    chrome.runtime.sendMessage({ type: "SYNC_START" }, () => void chrome.runtime.lastError);
    cerrarDialogo();
    mostrarDialogo(t("settings.sync"), t("settings.sync.hint"));
  } catch (error) {
    if (!error || error.name !== "AbortError") {
      mostrarDialogo(t("settings.sync"), t("common.error"));
    }
  }
}

function abrirAjustes() {
  const tema = (estado.settings && estado.settings.theme) || "system";
  const ajustes = estado.settings || {};
  const campos = [
    campo("theme", t("settings.theme"), {
      tipo: "select",
      valor: tema,
      opciones: ["light", "dark", "system"].map((valor) => ({
        valor,
        texto: t(`settings.theme.${valor}`),
      })),
    }),
    campo("defaultCollectionId", t("settings.defaultCollection"), {
      tipo: "select",
      valor: ajustes.defaultCollectionId || "",
      opciones: [
        { valor: "", texto: "—" },
        ...estado.collections.map((col) => ({ valor: col.id, texto: col.name })),
      ],
    }),
    campo("sortMode", t("sort.mode"), {
      tipo: "select",
      valor: ajustes.sortMode || "name",
      opciones: ["name", "createdAt", "updatedAt", "items"].map((valor) => ({
        valor,
        texto: t(`sort.mode.${valor}`),
      })),
    }),
    campo("sortDirection", t("sort.direction"), {
      tipo: "select",
      valor: ajustes.sortDirection || "asc",
      opciones: [
        { valor: "asc", texto: t("sort.direction.asc") },
        { valor: "desc", texto: t("sort.direction.desc") },
      ],
    }),
  ];
  const activa = Boolean(ajustes.sync && ajustes.sync.enabled);
  const botonSync = el("button", {
    type: "button",
    text: activa ? t("settings.sync.disable") : t("settings.sync.enable"),
    onclick: async () => {
      if (!activa) {
        await activarSync();
      } else {
        await mutar("updateSettings", { patch: { sync: { enabled: false } } });
        chrome.runtime.sendMessage({ type: "SYNC_STOP" }, () => void chrome.runtime.lastError);
        if (chrome.offscreen && chrome.offscreen.closeDocument) {
          chrome.offscreen.closeDocument().catch(() => {});
        }
        cerrarDialogo();
      }
    },
  });
  const botonRestaurar = el("button", {
    type: "button",
    text: t("settings.restore"),
    onclick: () => {
      modoJson = "restore";
      cerrarDialogo();
      refs.json.click();
    },
  });
  const botonCopia = el("button", {
    type: "button",
    text: t("sync.backup.view"),
    onclick: async () => {
      try {
        const copia = await leerDatoSync("sync-backup");
        if (!copia || !copia.texto) {
          mostrarDialogo(t("sync.backup.title"), t("sync.backup.empty"));
          return;
        }
        const fecha = copia.at ? new Date(copia.at).toLocaleString() : "";
        mostrarDialogo(
          t("sync.backup.title"),
          el(
            "div",
            {},
            el("p", { class: "progreso", text: fecha }),
            el("pre", { class: "copia-sync", text: copia.texto })
          ),
          [{ texto: t("common.close"), accion: cerrarDialogo }]
        );
      } catch {
        mostrarToast(t("common.error"));
      }
    },
  });
  dialogoFormulario({
    titulo: t("settings.title"),
    campos,
    extra: [
      el("p", { class: "progreso", text: t("settings.sync.hint") }),
      botonSync,
      botonCopia,
      botonRestaurar,
    ],
    aceptar: async (valores) => {
      await mutar("updateSettings", {
        patch: {
          theme: valores.theme,
          defaultCollectionId: valores.defaultCollectionId || null,
          sortMode: valores.sortMode,
          sortDirection: valores.sortDirection,
        },
      });
      cerrarDialogo();
      mostrarToast(t("settings.saved"));
    },
  });
}

// --- Acciones de la barra y del menú -------------------------------------

function editarItem(item) {
  dialogoFormulario({
    titulo: t("card.edit"),
    campos: [
      campo("title", t("collection.name"), { valor: item.title || "" }),
      campo("text", t("note.text"), { tipo: "textarea", valor: item.text || "" }),
    ],
    aceptar: async (valores) => {
      await mutar("updateItem", {
        itemId: item.id,
        patch: { title: valores.title, text: valores.text },
      });
      cerrarDialogo();
    },
  });
}

async function anadirPagina() {
  await verificar(await enviarMensaje({ type: "SAVE_PAGE" }));
  await leerEstado();
  mostrarToast(t("toast.saved"));
}

async function anadirTodasPestanas() {
  await verificar(await enviarMensaje({ type: "SAVE_ALL_TABS" }));
  await leerEstado();
  mostrarToast(t("toast.saved"));
}

function anadirNota() {
  dialogoFormulario({
    titulo: t("note.title"),
    campos: [campo("text", t("note.text"), { tipo: "textarea" })],
    aceptar: async (valores) => {
      const texto = String(valores.text || "").trim();
      if (!texto) return;
      const collectionId = await coleccionDestino();
      await mutar("addItem", {
        collectionId,
        item: {
          type: "note",
          title: texto.split("\n")[0].slice(0, 80),
          text: texto,
          url: "",
        },
      });
      cerrarDialogo();
    },
  });
}

function anadirImagen() {
  dialogoFormulario({
    titulo: t("image.title"),
    campos: [campo("url", t("image.url"), { tipo: "url" })],
    aceptar: async (valores) => {
      const url = urlSegura(valores.url);
      if (!url) throw new Error(t("common.error"));
      const collectionId = await coleccionDestino();
      await mutar("addItem", {
        collectionId,
        item: { type: "image", title: url, url, thumbnailUrl: url },
      });
      cerrarDialogo();
    },
  });
}

function nuevaColeccion() {
  dialogoFormulario({
    titulo: t("collection.new"),
    campos: [campo("name", t("collection.name"), { valor: t("collection.new") })],
    aceptar: async (valores) => {
      const nombre = String(valores.name || "").trim() || t("collection.new");
      const respuesta = await mutar("createCollection", { name: nombre });
      coleccionActivaId = respuesta.state.collections[respuesta.state.collections.length - 1].id;
      renderizar();
      cerrarDialogo();
    },
  });
}

function renombrarColeccionActual() {
  const col = coleccionActiva();
  if (!col) return;
  dialogoFormulario({
    titulo: t("collection.rename"),
    campos: [campo("name", t("collection.name"), { valor: col.name })],
    aceptar: async (valores) => {
      const nombre = String(valores.name || "").trim();
      if (nombre) await mutar("renameCollection", { id: col.id, name: nombre });
      cerrarDialogo();
    },
  });
}

function nuevaSeccion() {
  const col = coleccionActiva();
  if (!col) return;
  dialogoFormulario({
    titulo: t("section.new"),
    campos: [campo("title", t("section.title"), { valor: t("section.new") })],
    aceptar: async (valores) => {
      const titulo = String(valores.title || "").trim() || t("section.new");
      await mutar("createSection", { collectionId: col.id, title: titulo });
      cerrarDialogo();
    },
  });
}

function ordenar() {
  dialogoFormulario({
    titulo: t("menu.sort"),
    campos: [
      campo("mode", t("sort.mode"), {
        tipo: "select",
        valor: estado.settings.sortMode || "name",
        opciones: ["name", "createdAt", "updatedAt", "items"].map((valor) => ({
          valor,
          texto: t(`sort.mode.${valor}`),
        })),
      }),
      campo("direction", t("sort.direction"), {
        tipo: "select",
        valor: estado.settings.sortDirection || "asc",
        opciones: [
          { valor: "asc", texto: t("sort.direction.asc") },
          { valor: "desc", texto: t("sort.direction.desc") },
        ],
      }),
    ],
    aceptar: async (valores) => {
      await mutar("sortCollections", { mode: valores.mode, direction: valores.direction });
      await mutar("updateSettings", {
        patch: { sortMode: valores.mode, sortDirection: valores.direction },
      });
      cerrarDialogo();
    },
  });
}

const ACCIONES = {
  "add-page": anadirPagina,
  "add-note": anadirNota,
  "add-image": anadirImagen,
  "add-all-tabs": anadirTodasPestanas,
  sort: ordenar,
  "import-csv": importarCsv,
  "import-bing": importarBing,
  "import-sqlite": () => refs.sqlite.click(),
  "import-json": importarJson,
  "export-csv": () => exportar("csv"),
  "export-markdown": () => exportar("markdown"),
  "export-html": () => exportar("html"),
  "export-xlsx": () => exportar("xlsx"),
  "export-json": () => exportar("json"),
  "export-copy": () => exportar("copy"),
  settings: abrirAjustes,
};

function cerrarMenu() {
  refs.menu.hidden = true;
  refs.menuBtn.setAttribute("aria-expanded", "false");
}

document.querySelectorAll("[data-accion]").forEach((boton) => {
  boton.addEventListener("click", async () => {
    cerrarMenu();
    const accion = ACCIONES[boton.dataset.accion];
    if (accion) await accion();
  });
});

refs.menuBtn.addEventListener("click", () => {
  refs.menu.hidden = !refs.menu.hidden;
  refs.menuBtn.setAttribute("aria-expanded", String(!refs.menu.hidden));
});
document.addEventListener("click", (evento) => {
  if (!refs.menu.hidden && !refs.menu.contains(evento.target) && evento.target !== refs.menuBtn) {
    cerrarMenu();
  }
});
refs.back.addEventListener("click", () => {
  coleccionActivaId = null;
  renderizar();
});
refs.nuevaColeccion.addEventListener("click", nuevaColeccion);
refs.renombrar.addEventListener("click", renombrarColeccionActual);
refs.anadirSeccion.addEventListener("click", nuevaSeccion);
refs.borrarColeccion.addEventListener("click", () => {
  const col = coleccionActiva();
  if (!col) return;
  mostrarDialogo(t("collection.delete"), col.name, [
    { texto: t("common.cancel"), accion: cerrarDialogo },
    {
      texto: t("card.delete"),
      primario: true,
      accion: async () => {
        await mutar("deleteCollection", { id: col.id });
        coleccionActivaId = null;
        cerrarDialogo();
      },
    },
  ]);
});
refs.abrirTodo.addEventListener("click", async () => {
  const col = coleccionActiva();
  if (!col) return;
  for (const item of ordenarItems(col.items)) {
    const url = urlSegura(item.url);
    if (url) await chrome.tabs.create({ url });
  }
});

// --- Arranque -------------------------------------------------------------

async function inyectarDockEnPestanaActiva() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await enviarMensaje({ type: "INJECT_DRAG_DOCK", tabId: tab.id });
    }
  } catch {
    // Sin acceso a la pestaña se degrada a guardado por menú/atajo.
  }
}

chrome.storage.onChanged.addListener((cambios, area) => {
  if (area === "local" && Object.hasOwn(cambios, STATE_STORAGE_KEY)) leerEstado();
});

try {
  chrome.tabs.onActivated.addListener(inyectarDockEnPestanaActiva);
} catch {
  // Algunas versiones no exponen el evento sin permiso 'tabs'.
}

inyectarDockEnPestanaActiva();
leerEstado();
