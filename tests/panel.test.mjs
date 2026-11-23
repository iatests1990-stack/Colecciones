import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (ruta) =>
  readFileSync(new URL(ruta, import.meta.url), "utf8");

const html = leer("../sidepanel/panel.html");
const css = leer("../sidepanel/panel.css");
const js = leer("../sidepanel/panel.js");
const background = leer("../background.js");
const dock = leer("../content/drag-dock.js");

describe("Panel lateral - correcciones de UI 2026-11-23", () => {
  it("el botón '+ Nueva colección' va antes que la lista de colecciones", () => {
    const boton = html.indexOf('id="new-collection"');
    const lista = html.indexOf('id="collections-list"');
    assert.ok(boton >= 0 && lista >= 0 && boton < lista);
  });

  it("la eliminación de secciones está cableada de la UI al worker", () => {
    assert.ok(js.includes('mutar("replaceState"'), "falta el respaldo via replaceState");
    assert.ok(js.includes("deleteSection(estado"), "falta el reductor en el panel");
    assert.ok(background.includes("deleteSection:"), "falta la mutación en el worker");
    assert.ok(js.includes("seccion-eliminar"), "falta el botón en la cabecera");
  });
});

describe("Panel lateral - estructura y orquestación", () => {
  it("expone las dos vistas, el menú ⋯ y la barra de acciones en español", () => {
    for (const id of ["list-view", "detail-view", "menu-btn", "back-btn"]) {
      assert.ok(html.includes(`id="${id}"`), `Falta #${id} en panel.html`);
    }
    for (const texto of [
      "Añadir página",
      "Nota",
      "Imagen",
      "Todas las pestañas",
      "Ordenar",
      "Importar",
      "Exportar",
      "Ajustes",
    ]) {
      assert.ok(html.includes(texto), `Falta «${texto}» en panel.html`);
    }
    assert.ok(html.includes('type="module"'));
  });

  it("no escribe colecciones.state: delega todas las mutaciones al service worker", () => {
    assert.ok(!js.includes("chrome.storage.local.set"));
    assert.ok(!js.includes("STATE_STORAGE_KEY] ="));
    assert.ok(js.includes("chrome.storage.local.get"));
    assert.ok(js.includes("MUTATE_STATE"));
    assert.ok(background.includes("colaGuardado"));
    assert.ok(background.includes("MUTATE_STATE"));
  });

  it("muestra el aviso del CSV y calcula la vista previa antes de confirmar", () => {
    assert.ok(js.includes('t("import.csv.notice")'));
    assert.ok(js.includes("previewImport"));
    assert.ok(js.includes('t("import.preview"'));
    assert.ok(js.includes("importCollections"));
  });

  it("conecta el dock de arrastre y la importación de Bing Saves", () => {
    assert.ok(background.includes("INJECT_DRAG_DOCK"));
    assert.ok(background.includes("content/drag-dock.js"));
    assert.ok(js.includes("INJECT_DRAG_DOCK"));
    assert.ok(js.includes("INJECT_BING_SCRAPER"));
    assert.ok(dock.includes("dragstart"));
    assert.ok(dock.includes("drop"));
    assert.ok(dock.includes("DOCK_DROP"));
  });

  it("cae de miniatura a favicon y luego a enlace, y reacciona a storage.onChanged", () => {
    assert.ok(js.includes("thumbnailCandidates"));
    assert.ok(js.includes("storage.onChanged"));
    assert.ok(css.includes("data-theme"));
  });

  it("acota la importación de Bing con un timeout que limpia pendingBing y permite reintentar", () => {
    assert.ok(js.includes("BING_IMPORT_TIMEOUT_MS"), "Falta el límite de tiempo de Bing");
    assert.ok(
      /setTimeout\(\s*\(\)\s*=>\s*fallarBing\(t\("import\.bing\.timeout"\)\)\s*,\s*BING_IMPORT_TIMEOUT_MS\s*\)/.test(js),
      "El timeout acotado debe fallar con mensaje en español"
    );
    assert.ok(js.includes("function fallarBing"));
    assert.ok(/function fallarBing[\s\S]{0,400}limpiarBing\(\)/.test(js), "fallarBing no limpiapendingBing");
    assert.ok(/function fallarBing[\s\S]{0,800}actual\.resolver\(null\)/.test(js), "No resuelve null");
    assert.ok(/function fallarBing[\s\S]{0,800}cerrarDialogo\(\)/.test(js), "No cierra el diálogo de progreso");
    assert.ok(js.includes('t("import.bing.timeout")'), "Falta el mensaje de error en español");
    assert.ok(js.includes('t("import.retry")'), "Falta la acción de reintento");
    assert.ok(/function cancelarBing[\s\S]{0,400}limpiarBing\(\)/.test(js), "Cancelar también limpia pendingBing");
  });

  it("ignora BING_RESULT tardíos o duplicados después del timeout", () => {
    assert.ok(/if \(!pendingBing \|\| !mensaje\) return false;/.test(js), "El listener debe exigir pendingBing");
    assert.ok(/if \(mensaje\.type === "BING_RESULT"\)[\s\S]{0,600}limpiarBing\(\)/.test(js));
    assert.ok(js.includes("partitionItemsBySection"), "El panel usa el reparto puro de secciones");
  });

  it("un BING_RESULT sin payload cierra el progreso y muestra el error de inicio de sesión", () => {
    assert.ok(
      /if \(!mensaje\.payload\)[\s\S]{0,200}fallarBing\(t\("import\.bing\.login"\)\)/.test(js),
      "El payload nulo debe pasar por fallarBing, que limpia y cierra el diálogo"
    );
    assert.ok(
      !js.includes("actual.resolver(mensaje.payload || null)"),
      "No debe resolverse null sin reportar el error al usuario"
    );
    assert.ok(
      /if \(!payload\) return;/.test(js),
      "La ruta exitosa sigue evitando un segundo diálogo cuando fallarBing ya informó"
    );
  });
});

describe("Panel lateral - mover tarjetas entre colecciones y secciones", () => {
  it("el drop sobre una colección delega el movimiento a MUTATE_STATE", () => {
    const bloque = js.match(/function renderizarLista\(\)[\s\S]*?\n}\n\nfunction renderizarDetalle/)?.[0] || "";
    assert.ok(bloque.includes("dragover"), "La colección debe aceptar arrastre");
    assert.ok(bloque.includes('addEventListener("drop"'), "Debe tener manejador de drop");
    assert.ok(bloque.includes('mutar("moveItem"'), "El movimiento debe pasar por MUTATE_STATE");
    assert.ok(bloque.includes("targetCollectionId"), "Debe indicar la colección destino");
  });

  it("el drop sobre una sección delega la asignación a MUTATE_STATE", () => {
    const bloque = js.match(/function renderizarDetalle\(col\)[\s\S]*?\n}\n\n\/\/ --- Diálogos/)?.[0] || "";
    assert.ok(bloque.includes("dataset.sectionId"), "La cabecera debe identificar la sección");
    assert.ok(bloque.includes('addEventListener("drop"'), "La cabecera debe aceptar drop");
    assert.ok(
      bloque.includes('mutar("assignItemToSection"'),
      "La asignación debe pasar por MUTATE_STATE"
    );
    assert.ok(
      bloque.includes("mutar(\"moveItem\"") || bloque.includes('mutar("moveItem"'),
      "La barra de destinos debe permitir mover a otra colección desde el detalle"
    );
  });

  it("la barra de destinos y el resaltado de sección existen en HTML/CSS", () => {
    assert.ok(html.includes('id="move-targets"'));
    assert.ok(css.includes(".move-targets"));
    assert.ok(css.includes(".seccion-titulo.destino"));
    assert.ok(css.includes(".copia-sync"));
  });
});
