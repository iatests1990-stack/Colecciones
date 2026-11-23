import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { t } from "../lib/i18n.js";

describe("i18n - cadenas en español", () => {
  it("incluye literalmente el aviso de cuenta de empresa en Bing Saves", () => {
    assert.equal(
      t("import.bing.empty"),
      "No se encontraron colecciones. Si usas una cuenta de empresa o escolar, tus datos no están en Bing Saves; recupéralos desde el CSV o desde collectionsSQLite"
    );
  });

  it("incluye literalmente el aviso de pérdida de notas/imágenes del CSV", () => {
    assert.equal(
      t("import.csv.notice"),
      "El CSV solo contiene páginas: las notas y las imágenes no se pueden recuperar de él"
    );
  });

  it("interpola los recuentos exactos de la vista previa", () => {
    assert.equal(
      t("import.preview", { n: 2, m: 7 }),
      "Se importarán 2 colecciones y 7 elementos"
    );
  });

  it("devuelve la clave cuando no existe y tolera parámetros faltantes", () => {
    assert.equal(t("clave.inexistente"), "clave.inexistente");
    assert.equal(t("import.preview"), "Se importarán {n} colecciones y {m} elementos");
  });

  it("ofrece un error en español y una acción de reintento para el timeout de Bing", () => {
    assert.equal(t("import.bing.timeout"), "La importación de Bing Saves tardó demasiado. Vuelve a intentarlo.");
    assert.equal(t("import.retry"), "Reintentar");
  });

  it("expone las cadenas de la barra de acciones y del menú", () => {
    assert.equal(t("action.addPage"), "Añadir página");
    assert.equal(t("action.note"), "Nota");
    assert.equal(t("action.image"), "Imagen");
    assert.equal(t("action.allTabs"), "Todas las pestañas");
    assert.equal(t("menu.sort"), "Ordenar");
    assert.equal(t("menu.settings"), "Ajustes");
  });
});
