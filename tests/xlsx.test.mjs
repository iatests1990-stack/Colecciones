import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { crc32, zipFiles, buildXlsx } from "../lib/xlsx.js";

describe("crc32", () => {
  it("coincide con el vector de prueba 0xCBF43926 para '123456789'", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xCBF43926);
  });
});

describe("zipFiles", () => {
  it("empieza por PK\\x03\\x04 y termina con el EOCD PK\\x05\\x06", () => {
    const zip = zipFiles([{ name: "a.txt", data: Buffer.from("hola") }]);
    const latin = Buffer.from(zip).toString("latin1");
    assert.equal(latin.slice(0, 4), "PK\x03\x04");
    // Sin comentario, el EOCD de 22 bytes es el final del archivo y su
    // firma (4 bytes) queda en la posición length-22.
    assert.equal(latin.slice(latin.length - 22, latin.length - 18), "PK\x05\x06");
  });
});

describe("buildXlsx", () => {
  const collections = [
    {
      name: "Colección 1",
      items: [{ type: "page", title: "Google", url: "https://google.com" }],
    },
    {
      name: "Colección 2",
      items: [{ type: "page", title: "GitHub", url: "https://github.com" }],
    },
  ];

  it("produce un ZIP con dos <sheet> en workbook y celdas t=\"inlineStr\"", () => {
    const latin = Buffer.from(buildXlsx(collections)).toString("latin1");
    assert.ok(latin.includes("xl/workbook.xml"));
    assert.ok(latin.includes("xl/worksheets/sheet1.xml"));
    assert.equal((latin.match(/<sheet /g) || []).length, 2);
    assert.ok(latin.includes('t="inlineStr"'));
  });
});
