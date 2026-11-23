// Pruebas del importador de collectionsSQLite.
// Fixture MIT: https://raw.githubusercontent.com/rod-trent/Collections-Plus/main/fixtures/edge-collections-sample.sqlite
// El resto de bases se construyen en memoria para cubrir notas, imágenes y
// esquemas incompletos sin añadir más binarios al repositorio.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCollectionsSqlite } from "../lib/sqlite.js";

const fixture = new Uint8Array(
  await readFile(new URL("../fixtures/edge-collections-sample.sqlite", import.meta.url))
);
const sqliteSource = await readFile(new URL("../lib/sqlite.js", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../sidepanel/panel.js", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../lib/i18n.js", import.meta.url), "utf8");
const encoder = new TextEncoder();
const MAGIC = encoder.encode("SQLite format 3\0");

function concatBytes(...partes) {
  const total = parteLength(partes);
  const salida = new Uint8Array(total);
  let cursor = 0;
  for (const parte of partes) {
    salida.set(parte, cursor);
    cursor += parte.length;
  }
  return salida;
}

function parteLength(partes) {
  return partes.reduce((suma, parte) => suma + parte.length, 0);
}

function putUint16(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function putUint32(bytes, offset, value) {
  for (let i = 0; i < 4; i++) bytes[offset + 3 - i] = (value >>> (8 * i)) & 0xff;
}

// Varint SQLite (base 128, bit alto de continuidad). Solo valores positivos:
// longitudes de payload, números de serial y rowids.
function varint(valor) {
  let resto = Math.trunc(valor);
  const grupos = [];
  do {
    grupos.push(resto % 128);
    resto = Math.floor(resto / 128);
  } while (resto);
  const bytes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    bytes.push(i > 0 ? grupos[i] | 0x80 : grupos[i]);
  }
  return Uint8Array.from(bytes);
}

function codificarValor(valor) {
  if (valor === null || valor === undefined) return { serial: 0, bytes: new Uint8Array() };
  if (typeof valor === "number") {
    if (Number.isInteger(valor) && valor >= -128 && valor <= 127) {
      return { serial: 1, bytes: Uint8Array.from([valor & 0xff]) };
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, valor);
    return { serial: 7, bytes };
  }
  const bytes = valor instanceof Uint8Array ? valor : encoder.encode(String(valor));
  return {
    serial: (valor instanceof Uint8Array ? 12 : 13) + 2 * bytes.length,
    bytes,
  };
}

function codificarRegistro(valores) {
  const codificados = valores.map(codificarValor);
  const seriales = codificados.map((entrada) => varint(entrada.serial));
  const suma = parteLength(seriales);
  let longitud = 1 + suma;
  while (varint(longitud).length + suma !== longitud) longitud = varint(longitud).length + suma;
  return concatBytes(
    varint(longitud),
    ...seriales,
    ...codificados.map((entrada) => entrada.bytes)
  );
}

function paginaHoja(filas, { paginaUno = false, tamanoPagina = 4096 } = {}) {
  const pagina = new Uint8Array(tamanoPagina);
  const cabecera = paginaUno ? 100 : 0;
  const celdas = filas.map((fila, indice) => {
    const registro = codificarRegistro(fila);
    return concatBytes(varint(registro.length), varint(indice + 1), registro);
  });

  let cursor = tamanoPagina;
  const punteros = [];
  for (const celda of celdas) {
    cursor -= celda.length;
    pagina.set(celda, cursor);
    punteros.push(cursor);
  }

  pagina[cabecera] = 0x0d; // table b-tree leaf
  putUint16(pagina, cabecera + 3, celdas.length);
  putUint16(pagina, cabecera + 5, cursor);
  let puntero = cabecera + 8;
  for (const posicion of punteros) {
    putUint16(pagina, puntero, posicion);
    puntero += 2;
  }
  return pagina;
}

// Igual que paginaHoja, pero con registros ya codificados: permite construir
// un registro corrupto sin depender del codificador válido de esta prueba.
function paginaHojaConRegistrosCrudos(registros, { paginaUno = false } = {}) {
  const pagina = new Uint8Array(4096);
  const celdas = registros.map((registro, indice) =>
    concatBytes(varint(registro.length), varint(indice + 1), registro)
  );

  let cursor = pagina.length;
  const punteros = [];
  for (const celda of celdas) {
    cursor -= celda.length;
    pagina.set(celda, cursor);
    punteros.push(cursor);
  }

  const cabecera = paginaUno ? 100 : 0;
  pagina[cabecera] = 0x0d;
  putUint16(pagina, cabecera + 3, celdas.length);
  putUint16(pagina, cabecera + 5, cursor);
  let puntero = cabecera + 8;
  for (const posicion of punteros) {
    putUint16(pagina, puntero, posicion);
    puntero += 2;
  }
  return pagina;
}

// Base mínima de una sola página por tabla: suficiente para comprobar cómo el
// lector cruza sqlite_master, tablas, columnas y la tabla de relación.
function baseEnMemoria(filasMaestras, tablas) {
  const paginas = [
    paginaHoja(filasMaestras, { paginaUno: true }),
    ...tablas.map((tabla) => (tabla instanceof Uint8Array ? tabla : paginaHoja(tabla))),
  ];
  const base = concatBytes(...paginas);
  base.set(MAGIC, 0);
  putUint16(base, 16, 4096);
  base[18] = 1; // write version: legacy
  base[19] = 1; // read version: legacy
  base[20] = 0; // bytes reservados
  base[21] = 64;
  base[22] = 32;
  base[23] = 32;
  putUint32(base, 28, paginas.length); // número de páginas
  putUint32(base, 40, 1); // schema cookie
  putUint32(base, 44, 4); // schema format
  putUint32(base, 56, 1); // UTF-8
  return base;
}

function maestra(nombre, rootPage, columnas) {
  const sql = `CREATE TABLE ${nombre}(${columnas.map((c) => `${c} LONGVARCHAR`).join(", ")})`;
  return ["table", nombre, nombre, rootPage, sql];
}

function baseConNotasEImagenes() {
  const SQL_COLECCIONES = "id LONGVARCHAR, title LONGVARCHAR, position INTEGER, is_marked_for_deletion INTEGER";
  const SQL_ITEMS =
    "id LONGVARCHAR, title LONGVARCHAR, source BLOB, text_content LONGVARCHAR, type LONGVARCHAR, " +
    "canonical_image_data BLOB, canonical_image_url LONGVARCHAR, is_marked_for_deletion INTEGER";
  const SQL_RELACION = "item_id LONGVARCHAR, parent_id LONGVARCHAR, position INTEGER";
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  return baseEnMemoria(
    [
      maestra("collections", 2, ["id", "title", "position", "is_marked_for_deletion"]),
      maestra("items", 3, [
        "id",
        "title",
        "source",
        "text_content",
        "type",
        "canonical_image_data",
        "canonical_image_url",
        "is_marked_for_deletion",
      ]),
      maestra("collections_items_relationship", 4, ["item_id", "parent_id", "position"]),
    ],
    [
      [["c1", "Proyecto", 1, 0]],
      [
        ["n1", "Nota importante", "{}", "Comprar café y filtros", "annotation", null, "", 0],
        ["m1", "Foto", '{"url":"https://img.example.com/foto.png"}', "", "image", null, "https://img.example.com/foto.png", 0],
        ["b1", "Imagen incrustada", "{}", "", "image", png, "", 0],
        ["t1", "Texto seleccionado", "{}", "Párrafo seleccionado", "text", null, "", 0],
      ],
      [
        ["m1", "c1", 1],
        ["n1", "c1", 2],
        ["b1", "c1", 3],
        ["t1", "c1", 4],
      ],
    ]
  );
}

describe("Importador de collectionsSQLite", () => {
  it("rechaza un archivo que no empieza por la cabecera SQLite", () => {
    assert.throws(() => readCollectionsSqlite(Buffer.from("basura")), {
      message: "NOT_A_SQLITE_DB",
    });
  });

  it("propaga SQLITE_UNSUPPORTED si el tamaño de página es inválido", () => {
    const corrupto = fixture.slice();
    putUint16(corrupto, 16, 128);
    assert.throws(() => readCollectionsSqlite(corrupto), {
      message: "SQLITE_UNSUPPORTED",
    });
  });

  it("propaga SQLITE_CORRUPT si un archivo con cabecera válida está truncado", () => {
    assert.throws(() => readCollectionsSqlite(fixture.subarray(0, 4106)), {
      message: "SQLITE_CORRUPT",
    });
  });

  it("lee el fixture y devuelve colecciones con ítems no vacíos", () => {
    const resultado = readCollectionsSqlite(fixture);
    assert.ok(resultado.collections.length >= 1);
    assert.ok(resultado.collections.some((col) => col.items.length > 0));
    assert.deepEqual(
      resultado.collections.map((col) => col.name),
      ["Travel", "Recipes"]
    );
    assert.equal(resultado.stats.collections, 2);
    assert.equal(resultado.stats.items, 3);
  });

  it("conserva título y URL del source JSON embebido", () => {
    const { collections } = readCollectionsSqlite(fixture);
    const recipes = collections.find((col) => col.name === "Recipes");
    assert.deepEqual(recipes.items.map((item) => item.title), ["Second", "Big Image Page"]);
    assert.equal(recipes.items[0].url, "https://example.com/2");
    assert.equal(recipes.items[1].url, "https://example.com/big");
    assert.equal(collections[0].items[0].url, "https://travel.com/1");
    for (const item of collections.flatMap((col) => col.items)) {
      assert.ok(["page", "link", "image", "text", "note"].includes(item.type));
      assert.ok(!("heading" in item));
    }
  });

  it("recupera thumbnailUrl y thumbnailData (incluido un payload que desborda la página)", () => {
    const { collections } = readCollectionsSqlite(fixture);
    const recipes = collections.find((col) => col.name === "Recipes");
    const [segunda, grande] = recipes.items;
    assert.equal(segunda.thumbnailUrl, "https://cdn.example.com/2.png");
    assert.ok(!segunda.thumbnailData);
    assert.ok(grande.thumbnailData.startsWith("data:image/png;base64,"));
    assert.ok(grande.thumbnailData.length > 7000);
    assert.ok(!grande.thumbnailUrl);
  });

  it("respeta collections_items_relationship.position y omite borrados y vacíos", () => {
    const { collections, stats } = readCollectionsSqlite(fixture);
    const recipes = collections.find((col) => col.name === "Recipes");
    assert.deepEqual(recipes.items.map((item) => item.title), ["Second", "Big Image Page"]);
    assert.ok(!collections.some((col) => col.name === "Deleted"));
    assert.ok(!recipes.items.some((item) => item.title === "Deleted Item"));
    assert.ok(!recipes.items.some((item) => item.title === "No URL Item"));
    assert.equal(stats.skipped, 2);
  });

  it("recupera notas, imágenes y texto con tipos canónicos desde una base sintética", () => {
    const resultado = readCollectionsSqlite(baseConNotasEImagenes());
    const col = resultado.collections[0];
    assert.equal(col.name, "Proyecto");
    assert.deepEqual(col.items.map((item) => item.title), [
      "Foto",
      "Nota importante",
      "Imagen incrustada",
      "Texto seleccionado",
    ]);

    const [foto, nota, incrustada, texto] = col.items;
    assert.equal(foto.type, "image");
    assert.equal(foto.url, "https://img.example.com/foto.png");
    assert.equal(foto.thumbnailUrl, "https://img.example.com/foto.png");

    assert.equal(nota.type, "note");
    assert.equal(nota.url, "");
    assert.equal(nota.text, "Comprar café y filtros");

    assert.equal(incrustada.type, "image");
    assert.ok(incrustada.thumbnailData.startsWith("data:image/png;base64,"));

    assert.equal(texto.type, "text");
    assert.equal(texto.text, "Párrafo seleccionado");

    assert.equal(resultado.stats.notes, 1);
    assert.equal(resultado.stats.images, 2);
    assert.equal(resultado.stats.texts, 1);
    assert.equal(resultado.stats.pages, 0);
  });

  it("devuelve colecciones vacías si falta alguna tabla", () => {
    const resultado = readCollectionsSqlite(
      baseEnMemoria([maestra("otra", 2, ["id"])], [[["x"]]])
    );
    assert.deepEqual(resultado.collections, []);
    assert.equal(resultado.stats.collections, 0);
    assert.equal(resultado.stats.items, 0);
  });

  it("mantiene el vacío intencional aunque falte solo una de las tablas de Edge", () => {
    const base = baseEnMemoria(
      [
        maestra("collections", 2, ["id"]),
        maestra("items", 3, ["id"]),
      ],
      [[["c1"]], [["i1"]]]
    );
    const resultado = readCollectionsSqlite(base);
    assert.deepEqual(resultado.collections, []);
    assert.equal(resultado.stats.collections, 0);
  });

  it("propaga SQLITE_CORRUPT si un registro declara más bytes de los disponibles", () => {
    // serial 113 => texto de 50 bytes, pero el payload solo trae 2 bytes de dato.
    const registroCorrupto = Uint8Array.from([2, 113, 0x41, 0x42]);
    const base = baseEnMemoria(
      [
        maestra("collections", 2, ["id"]),
        maestra("items", 3, ["id"]),
        maestra("collections_items_relationship", 4, ["item_id"]),
      ],
      [
        paginaHojaConRegistrosCrudos([registroCorrupto]),
        paginaHoja([]),
        paginaHoja([]),
      ]
    );
    assert.throws(() => readCollectionsSqlite(base), {
      message: "SQLITE_CORRUPT",
    });
  });

  it("es puro: sin chrome, sin DOM, sin red y sin dependencias", () => {
    assert.ok(!/\bchrome\b/.test(sqliteSource));
    assert.ok(!/\bdocument\b/.test(sqliteSource));
    assert.ok(!/\bfetch\s*\(/.test(sqliteSource));
    assert.ok(!/\bimport\s/.test(sqliteSource));
    assert.ok(!/\brequire\s*\(/.test(sqliteSource));
  });

  it("el panel usa el selector propio y delega la mutación al worker", () => {
    assert.ok(panelSource.includes("await import(\"../lib/sqlite.js\")"));
    assert.ok(panelSource.includes("readCollectionsSqlite(bytes)"));
    assert.ok(panelSource.includes("refs.sqlite.click()"));
    assert.ok(panelSource.includes("import.sqlite.summary"));
    assert.ok(panelSource.includes("mutar(\"importCollections\""));
  });

  it("muestra un error específico ante un SQLite corrupto, no el mensaje de vacío", () => {
    assert.ok(i18nSource.includes("\"import.sqlite.corrupt\""));
    assert.ok(panelSource.includes("motivo === \"SQLITE_CORRUPT\""));
    assert.ok(panelSource.includes("motivo === \"SQLITE_UNSUPPORTED\""));
    assert.ok(panelSource.includes("t(\"import.sqlite.corrupt\")"));

    const inicio = panelSource.indexOf("refs.sqlite.addEventListener(\"change\"");
    const handler = panelSource.slice(inicio);
    const catchIndex = handler.indexOf("catch (error)");
    const bloqueCatch = handler.slice(catchIndex, catchIndex + 600);
    assert.ok(!bloqueCatch.includes("import.sqlite.empty"));
  });
});
