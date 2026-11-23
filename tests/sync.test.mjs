import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEMA_VERSION, createEmptyState, createCollection } from "../lib/store.js";
import { syncPayload, mergeStates, shouldPull } from "../lib/sync.js";

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");

const estadoEn = (updatedAt, nombre = "Base") => ({
  ...createCollection(createEmptyState(), nombre),
  updatedAt,
});

describe("Sincronización por archivo - payload", () => {
  it("syncPayload usa la versión del esquema y una marca de tiempo numérica", () => {
    const estado = estadoEn(1234);
    const payload = syncPayload(estado);
    assert.strictEqual(payload.version, SCHEMA_VERSION);
    assert.strictEqual(typeof payload.updatedAt, "number");
    assert.ok(Number.isFinite(payload.updatedAt));
  });

  it("syncPayload conserva la marca del estado y el estado original", () => {
    const estado = estadoEn(4321);
    const payload = syncPayload(estado);
    assert.strictEqual(payload.updatedAt, 4321);
    assert.strictEqual(payload.state, estado);
  });
});

describe("Sincronización por archivo - fusión", () => {
  it("gana el remoto cuando su marca es más reciente, sin conflicto", () => {
    const local = estadoEn(100, "Local");
    const remoto = estadoEn(200, "Remoto");
    const resultado = mergeStates(local, remoto, 300);
    assert.strictEqual(resultado.conflict, false);
    assert.strictEqual(resultado.state, remoto);
  });

  it("gana el local cuando su marca es más reciente, sin conflicto", () => {
    const local = estadoEn(200, "Local");
    const remoto = estadoEn(100, "Remoto");
    const resultado = mergeStates(local, remoto, 300);
    assert.strictEqual(resultado.conflict, false);
    assert.strictEqual(resultado.state, local);
  });

  it("marcas iguales con contenido distinto marcan conflicto y gana el local", () => {
    const local = estadoEn(100, "Local");
    const remoto = estadoEn(100, "Remoto");
    const resultado = mergeStates(local, remoto, 300);
    assert.strictEqual(resultado.conflict, true);
    assert.strictEqual(resultado.state, local);
  });

  it("marcas iguales con contenido idéntico no marcan conflicto", () => {
    const local = estadoEn(100, "Igual");
    const remoto = JSON.parse(JSON.stringify(local));
    const resultado = mergeStates(local, remoto, 300);
    assert.strictEqual(resultado.conflict, false);
    assert.strictEqual(resultado.state, local);
  });
});

describe("Sincronización por archivo - decisión de pull", () => {
  it("shouldPull es true solo cuando el remoto es más reciente", () => {
    assert.strictEqual(shouldPull({ updatedAt: 1 }, { updatedAt: 2 }), true);
    assert.strictEqual(shouldPull({ updatedAt: 1 }, { updatedAt: 1 }), false);
    assert.strictEqual(shouldPull({ updatedAt: 2 }, { updatedAt: 1 }), false);
  });

  it("shouldPull es conservador con marcas ausentes o no numéricas", () => {
    assert.strictEqual(shouldPull({}, { updatedAt: 2 }), false);
    assert.strictEqual(shouldPull({ updatedAt: 1 }, {}), false);
    assert.strictEqual(shouldPull(null, null), false);
  });
});

describe("Sincronización por archivo - límites puros y cableado", () => {
  it("lib/sync.js es puro: sin chrome, sin ventana y sin documento", () => {
    const fuente = leer("../lib/sync.js");
    assert.ok(!/\bchrome\b/.test(fuente), "lib/sync.js no debe usar chrome");
    assert.ok(!/\bwindow\b/.test(fuente), "lib/sync.js no debe usar window");
    assert.ok(!/\bdocument\b/.test(fuente), "lib/sync.js no debe usar document");
  });

  it("el manifiesto conserva el permiso offscreen y el documento existe", () => {
    const manifest = JSON.parse(leer("../manifest.json"));
    assert.ok(manifest.permissions.includes("offscreen"));
    assert.ok(leer("../offscreen/offscreen.html").includes('src="offscreen.js"'));
  });

  it("el documento offscreen crea su ventana con BLOBS y la justificación acordada", () => {
    const fuente = leer("../offscreen/offscreen.js");
    assert.ok(fuente.includes("chrome.offscreen.createDocument"));
    assert.ok(/reasons:\s*\[\s*["']BLOBS["']\s*\]/.test(fuente));
    assert.ok(fuente.includes("Sincronización del archivo de colecciones"));
    assert.ok(fuente.includes("indexedDB"));
    assert.ok(fuente.includes("queryPermission"));
    assert.ok(fuente.includes("shouldPull") && fuente.includes("mergeStates"));
    assert.ok(fuente.includes("MUTATE_STATE") || fuente.includes("replaceState"));
  });

  it("el documento offscreen solo usa chrome.runtime y el worker le entrega el estado", () => {
    const offscreen = leer("../offscreen/offscreen.js");
    const worker = leer("../background.js");
    assert.ok(!/chrome\.storage/.test(offscreen), "offscreen no expone chrome.storage");
    assert.ok(offscreen.includes("SYNC_GET_STATE"));
    assert.ok(worker.includes('case "SYNC_GET_STATE"'));
    assert.ok(worker.includes("MUTATE_STATE"));
  });

  it("el panel abre el selector con gesto de usuario y no escribe el estado", () => {
    const panel = leer("../sidepanel/panel.js");
    assert.ok(panel.includes("showOpenFilePicker"));
    assert.ok(panel.includes('indexedDB.open("colecciones"'));
    assert.ok(panel.includes('"handles"'));
    assert.ok(panel.includes("SYNC_START") && panel.includes("SYNC_STOP"));
    assert.ok(panel.includes("SYNC_PERMISSION_LOST"));
    assert.ok(!panel.includes("chrome.storage.local.set"));
  });
});

describe("Sincronización por archivo - fix round 1", () => {
  it("SYNC_GET_STATE responde con { state } y el offscreen lee respuesta.state", () => {
    const worker = leer("../background.js");
    const offscreen = leer("../offscreen/offscreen.js");
    assert.ok(/case "SYNC_GET_STATE"[\s\S]{0,320}state: await leerEstado\(\)/.test(worker));
    assert.ok(offscreen.includes("respuesta.ok ? respuesta.state : null"));
  });

  it("el worker recrea el documento offscreen al arrancar si la sync estaba activa", () => {
    const worker = leer("../background.js");
    assert.ok(worker.includes("asegurarDocumentoOffscreen"));
    assert.ok(worker.includes("chrome.runtime.onStartup.addListener(asegurarSyncAlArrancar)"));
    assert.ok(worker.includes("chrome.runtime.onInstalled.addListener(asegurarSyncAlArrancar)"));
    assert.ok(
      /function asegurarSyncAlArrancar[\s\S]{0,700}asegurarDocumentoOffscreen\(\)/.test(worker)
    );
  });

  it("el mismo remoto normalizado alimenta el pull y la detección de conflictos", () => {
    const offscreen = leer("../offscreen/offscreen.js");
    assert.equal((offscreen.match(/mergeStates\(local, remotoNormalizado/g) || []).length, 2);
    const local = estadoEn(100, "Local");
    const remotoDentro = estadoEn(50, "Remoto");
    const normalizado = { ...remotoDentro, updatedAt: 100 };
    const fusion = mergeStates(local, normalizado, 300);
    assert.strictEqual(fusion.conflict, true);
    assert.strictEqual(fusion.state, local);
  });

  it("SYNC_START limpia el pestillo de re-elección antes de la guardia del temporizador", () => {
    const offscreen = leer("../offscreen/offscreen.js");
    assert.ok(
      /function iniciar\(\)\s*\{\s*permisoPendiente = false;[\s\S]{0,180}temporizador === null/.test(
        offscreen
      )
    );
    assert.ok(/if \(mensaje\.type === "SYNC_START"\)[\s\S]{0,80}iniciar\(\);/.test(offscreen));
    assert.ok(offscreen.includes("avisarPermisoPerdido"));
  });

  it("el worker ya expone replaceState para aplicar el estado remoto", () => {
    const worker = leer("../background.js");
    assert.ok(/replaceState:\s*\(estado, p\) => migrate\(p\.state\)/.test(worker));
  });
});

describe("Sincronización por archivo - conflicto visible y confirmado", () => {
  const offscreen = leer("../offscreen/offscreen.js");
  const panel = leer("../sidepanel/panel.js");

  it("al detectar conflicto guarda la copia como pendiente y NO sobrescribe el remoto", () => {
    const bloque = offscreen.match(/if \(fusion\.conflict\) \{[\s\S]*?\n    \}/)?.[0] || "";
    assert.ok(bloque.includes("pendiente: true"), "La copia debe quedar marcada como pendiente");
    assert.ok(bloque.includes('type: "SYNC_CONFLICT"'), "Debe avisar al panel del conflicto");
    assert.ok(!bloque.includes("escribirRemoto("), "No debe escribir el archivo sin confirmación");
    assert.ok(
      /const copia = await leerClave\(CLAVE_COPIA\);[\s\S]{0,220}copia\.pendiente === true/.test(offscreen),
      "Mientras haya conflicto pendiente el bombeo no debe reintentar la sobrescritura"
    );
  });

  it("SYNC_RESOLVE_CONFLICT exige confirmación explícita, escribe y conserva la copia", () => {
    assert.ok(offscreen.includes('mensaje.type === "SYNC_RESOLVE_CONFLICT"'));
    assert.ok(offscreen.includes("mensaje.confirm !== true"), "Sin confirm no se escribe");
    const bloque = offscreen.match(/async function resolverConflicto[\s\S]*?\n}/)?.[0] || "";
    assert.ok(bloque.includes("copia.pendiente !== true"), "Debe existir un conflicto pendiente");
    assert.ok(bloque.includes("escribirRemoto("), "Tras confirmar sí se escribe el remoto");
    assert.ok(bloque.includes("copia.texto"), "La copia remota se conserva como respaldo");
    assert.ok(bloque.includes('type: "SYNC_STATUS"'), "Informa del resultado al panel");
    assert.ok(panel.includes('type: "SYNC_RESOLVE_CONFLICT"'));
    assert.ok(panel.includes("confirm: true"));
  });

  it("el panel informa del conflicto, muestra la copia y permite inspeccionarla después", () => {
    assert.ok(panel.includes('mensaje.type === "SYNC_CONFLICT"'));
    assert.ok(panel.includes("mostrarConflictoSync"));
    assert.ok(panel.includes('t("sync.conflict.message")'));
    assert.ok(panel.includes('t("sync.conflict.overwrite")'));
    assert.ok(panel.includes('leerDatoSync("sync-backup")'));
    assert.ok(panel.includes('t("sync.backup.view")'));
    assert.ok(panel.includes("copia.pendiente === true"));
    assert.ok(panel.includes('t("sync.conflict.resolved")'));
  });

  it("el diccionario ofrece los textos del conflicto en español", async () => {
    const { t } = await import("../lib/i18n.js");
    for (const clave of [
      "sync.conflict.title",
      "sync.conflict.message",
      "sync.conflict.overwrite",
      "sync.conflict.resolved",
      "sync.backup.view",
      "sync.backup.title",
    ]) {
      assert.notStrictEqual(t(clave), clave, `Falta la cadena ${clave}`);
    }
  });
});
