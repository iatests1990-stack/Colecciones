import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { toCsv, toJsonBackup, parseJsonBackup } from "../lib/export.js";

const collections = [
  {
    name: "Colección 1",
    items: [
      { type: "page", title: "Google", url: "https://google.com" },
      { type: "page", title: "Tokyo, Japan guide", url: "https://example.com/japan" },
      { type: "note", title: "Mis notas", text: "Texto de la nota" },
    ],
  },
  {
    name: "Colección 2",
    items: [
      { type: "link", title: 'Dice "hola"', url: "https://example.com/quote" },
    ],
  },
];

describe("toCsv", () => {
  it("emite la cabecera Collection,Title,URL", () => {
    const rows = toCsv(collections).split(/\r?\n/);
    assert.equal(rows[0], "Collection,Title,URL");
  });

  it("emite una fila por página y no incluye notas como filas de URL", () => {
    const csv = toCsv(collections);
    const rows = csv.split(/\r?\n/).filter(Boolean);
    // cabecera + 3 páginas (Google, Tokyo, link con comillas) = 4 filas
    assert.equal(rows.length, 4);
    assert.ok(!csv.includes("Mis notas"));
    assert.ok(!csv.includes("Texto de la nota"));
  });

  it("cite entre comillas un título con coma (RFC 4180)", () => {
    assert.ok(toCsv(collections).includes('"Tokyo, Japan guide"'));
  });

  it("duplica las comillas internas de un título (RFC 4180)", () => {
    assert.ok(toCsv(collections).includes('"Dice ""hola"""'));
  });
});

describe("backup JSON", () => {
  const state = {
    schemaVersion: 1,
    collections,
    settings: { theme: "system" },
    updatedAt: 1234567890,
  };

  it("toJsonBackup -> parseJsonBackup devuelve un estado deep-equal", () => {
    assert.deepEqual(parseJsonBackup(toJsonBackup(state)), state);
  });

  it("lanza si schemaVersion es inválido (999)", () => {
    const bad = JSON.stringify({ ...state, schemaVersion: 999 });
    assert.throws(() => parseJsonBackup(bad));
  });
});
