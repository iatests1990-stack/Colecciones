// offscreen/offscreen.js
// Documento offscreen: mantiene el bombeo de sincronización con el panel
// cerrado. El selector de archivo solo se abre en el panel (necesita ventana y
// gesto del usuario); aquí se reutiliza el handle guardado en IndexedDB.
import { SCHEMA_VERSION, migrate } from "../lib/store.js";
import { mergeStates, shouldPull, syncPayload } from "../lib/sync.js";

const INTERVALO_MS = 15000;
const NOMBRE_BASE = "colecciones";
const ALMACEN = "handles";
const CLAVE_HANDLE = "sync";
const CLAVE_COPIA = "sync-backup";

let temporizador = null;
let bombeando = false;
let permisoPendiente = false;

const tieneApi = typeof chrome !== "undefined" && Boolean(chrome.runtime);
const urlDocumento = tieneApi ? chrome.runtime.getURL("offscreen/offscreen.html") : "";

function enviar(mensaje) {
  if (!tieneApi) return;
  try {
    chrome.runtime.sendMessage(mensaje, () => void chrome.runtime.lastError);
  } catch {
    // No hay receptores: el panel puede estar cerrado.
  }
}

async function existeDocumento() {
  if (chrome.runtime.getContexts) {
    const contextos = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [urlDocumento],
    });
    return contextos.length > 0;
  }
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    return Boolean(await chrome.offscreen.hasDocument());
  }
  return false;
}

// Crea el documento offscreen con el motivo BLOBS. Se llama desde el panel
// tras conseguir el handle; si ya existe, no se duplica.
export async function asegurarDocumentoOffscreen() {
  if (!tieneApi || !chrome.offscreen) return;
  try {
    if (await existeDocumento()) return;
    await chrome.offscreen.createDocument({
      url: urlDocumento,
      reasons: ["BLOBS"],
      justification: "Sincronización del archivo de colecciones",
    });
  } catch {
    // Ya hay un documento con otro motivo o el navegador rechaza la creación.
  }
}

function abrirBase() {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(NOMBRE_BASE, 1);
    peticion.onupgradeneeded = () => {
      if (!peticion.result.objectStoreNames.contains(ALMACEN)) {
        peticion.result.createObjectStore(ALMACEN);
      }
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

async function leerClave(clave) {
  const base = await abrirBase();
  return new Promise((resolver, rechazar) => {
    const peticion = base.transaction(ALMACEN, "readonly").objectStore(ALMACEN).get(clave);
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

async function escribirClave(clave, valor) {
  const base = await abrirBase();
  return new Promise((resolver, rechazar) => {
    const transaccion = base.transaction(ALMACEN, "readwrite");
    transaccion.objectStore(ALMACEN).put(valor, clave);
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

async function permisoConcedido(handle) {
  const estado = await handle.queryPermission({ mode: "readwrite" });
  return estado === "granted";
}

async function leerRemoto(handle) {
  const archivo = await handle.getFile();
  const texto = await archivo.text();
  if (!texto.trim()) return null;
  const datos = JSON.parse(texto);
  if (!datos || datos.version !== SCHEMA_VERSION || !datos.state) return null;
  return { texto, payload: { ...datos, state: migrate(datos.state) } };
}

async function escribirRemoto(handle, texto, copiaAnterior, pendiente = false) {
  if (copiaAnterior) {
    await escribirClave(CLAVE_COPIA, {
      texto: copiaAnterior,
      at: Date.now(),
      pendiente,
    });
  }
  const escritor = await handle.createWritable();
  try {
    await escritor.write(texto);
  } finally {
    await escritor.close();
  }
}

// Un documento offscreen solo expone chrome.runtime: el estado se pide al
// service worker, que sí puede leer el almacenamiento de la extensión.
function pedirEstado() {
  return new Promise((resolver) => {
    chrome.runtime.sendMessage({ type: "SYNC_GET_STATE" }, (respuesta) => {
      void chrome.runtime.lastError;
      resolver(respuesta && respuesta.ok ? respuesta.state : null);
    });
  });
}

function aplicarEstado(estado) {
  return new Promise((resolver) => {
    chrome.runtime.sendMessage(
      { type: "MUTATE_STATE", op: "replaceState", payload: { state: estado } },
      (respuesta) => {
        void chrome.runtime.lastError;
        resolver(respuesta);
      }
    );
  });
}

function avisarPermisoPerdido() {
  if (permisoPendiente) return;
  permisoPendiente = true;
  enviar({ type: "SYNC_PERMISSION_LOST" });
}

// Solo el panel puede pedir la sobrescritura: el documento offscreen no decide
// por el usuario. La copia del remoto permanece en IndexedDB hasta que se
// confirme, y se conserva como respaldo después de escribir.
async function resolverConflicto(mensaje) {
  if (mensaje.confirm !== true) {
    return { ok: false, error: "Falta la confirmación del usuario" };
  }
  const copia = await leerClave(CLAVE_COPIA);
  if (!copia || copia.pendiente !== true) {
    return { ok: false, error: "No hay ningún conflicto pendiente" };
  }
  const handle = await leerClave(CLAVE_HANDLE);
  if (!handle || !(await permisoConcedido(handle))) {
    avisarPermisoPerdido();
    return { ok: false, error: "Permiso de archivo revocado" };
  }
  const persistido = await pedirEstado();
  if (!persistido) return { ok: false, error: "No se pudo leer el estado local" };
  const local = migrate(persistido);
  await escribirRemoto(
    handle,
    JSON.stringify(syncPayload(local), null, 2),
    copia.texto
  );
  enviar({
    type: "SYNC_STATUS",
    ok: true,
    action: "push",
    conflictResolved: true,
  });
  return { ok: true };
}

async function bombear() {
  if (bombeando) return;
  bombeando = true;
  try {
    const persistido = await pedirEstado();
    if (!persistido) return;
    const sync = persistido.settings && persistido.settings.sync;
    if (!sync || !sync.enabled) {
      detener();
      return;
    }

    const handle = await leerClave(CLAVE_HANDLE);
    if (!handle || !(await permisoConcedido(handle))) {
      avisarPermisoPerdido();
      return;
    }
    permisoPendiente = false;

    const local = migrate(persistido);
    const remoto = await leerRemoto(handle);

    const copia = await leerClave(CLAVE_COPIA);
    if (copia && copia.pendiente === true) {
      // Conflicto sin resolver: se deja el archivo remoto intacto y se recuerda
      // el aviso al panel. La decisión sigue siendo del usuario.
      enviar({
        type: "SYNC_CONFLICT",
        ok: true,
        at: copia.at,
        remoteText: copia.texto,
      });
      return;
    }

    if (!remoto) {
      await escribirRemoto(handle, JSON.stringify(syncPayload(local), null, 2), null);
      enviar({ type: "SYNC_STATUS", ok: true, action: "push" });
      return;
    }

    const marcaLocal = { updatedAt: local.updatedAt };
    const marcaRemota = { updatedAt: remoto.payload.updatedAt };
    // El sobre manda sobre el contenido: un archivo editado a mano puede tener
    // una marca distinta dentro del estado. Se normaliza una sola vez para que
    // el pull y la detección de conflictos usen exactamente el mismo remoto.
    const remotoNormalizado = {
      ...remoto.payload.state,
      updatedAt: remoto.payload.updatedAt,
    };

    if (shouldPull(marcaLocal, marcaRemota)) {
      const fusion = mergeStates(local, remotoNormalizado, Date.now());
      const respuesta = await aplicarEstado(fusion.state);
      if (!respuesta || !respuesta.ok) throw new Error("No se pudo aplicar el estado remoto");
      enviar({ type: "SYNC_STATUS", ok: true, action: "pull" });
      return;
    }

    if (local.updatedAt > remoto.payload.updatedAt) {
      await escribirRemoto(handle, JSON.stringify(syncPayload(local), null, 2), remoto.texto);
      enviar({ type: "SYNC_STATUS", ok: true, action: "push" });
      return;
    }

    // Marcas iguales con contenido divergente: no se escribe nada todavía. Se
    // guarda la copia remota como pendiente y el panel pide confirmación antes
    // de permitir la sobrescritura. El estado local nunca se sustituye aquí.
    const fusion = mergeStates(local, remotoNormalizado, Date.now());
    if (fusion.conflict) {
      const ahora = Date.now();
      await escribirClave(CLAVE_COPIA, {
        texto: remoto.texto,
        at: ahora,
        pendiente: true,
      });
      enviar({
        type: "SYNC_CONFLICT",
        ok: true,
        at: ahora,
        remoteText: remoto.texto,
      });
      return;
    }
    enviar({ type: "SYNC_STATUS", ok: true, action: "none" });
  } catch (error) {
    enviar({
      type: "SYNC_STATUS",
      ok: false,
      error: String((error && error.message) || error),
    });
  } finally {
    bombeando = false;
  }
}

// SYNC_START también llega al reabrir el panel con el temporizador ya activo:
// el pestillo del aviso se limpia ANTES de la guardia y se fuerza un bombeo
// inmediato para que un permiso revocado vuelva a notificarse.
function iniciar() {
  permisoPendiente = false;
  if (temporizador === null) {
    temporizador = setInterval(bombear, INTERVALO_MS);
  }
  bombear();
}

function detener() {
  if (temporizador !== null) clearInterval(temporizador);
  temporizador = null;
}

export function procesarMensaje(mensaje, remitente, responder) {
  if (!mensaje) return false;
  if (mensaje.type === "SYNC_START") {
    iniciar();
  } else if (mensaje.type === "SYNC_STOP") {
    detener();
  } else if (mensaje.type === "SYNC_RESOLVE_CONFLICT") {
    const resolucion = Promise.resolve().then(() => resolverConflicto(mensaje));
    if (responder) {
      resolucion
        .then((resultado) => responder(resultado))
        .catch((error) =>
          responder({
            ok: false,
            error: String((error && error.message) || error),
          })
        );
    } else {
      void resolucion;
    }
    return true;
  }
  return false;
}

// Este módulo también se importa desde el panel para crear el documento; solo
// arranca el bombeo cuando se ejecuta dentro del propio documento offscreen.
if (tieneApi && typeof location !== "undefined" && location.href === urlDocumento) {
  chrome.runtime.onMessage.addListener(procesarMensaje);
  iniciar();
}
