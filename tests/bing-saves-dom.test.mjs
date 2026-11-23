// Pruebas de los helpers puros extraídos de content/bing-saves.js y
// verificación estática del scraper y del fixture HTML (R3: sin cuenta MSA).
import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../content/bing-saves.js", import.meta.url), "utf-8");
const fixtureHtml = await readFile(
  new URL("../fixtures/bing-saves.sample.html", import.meta.url),
  "utf-8"
);

function cargarScraper() {
  const sandbox = {
    __COLECCIONES_BING_TEST__: true,
    console,
    URL,
    setTimeout,
    clearTimeout,
    window: { addEventListener() {} },
    document: {
      baseURI: "https://www.bing.com/saves",
      readyState: "complete",
      body: { innerText: "", textContent: "" },
      addEventListener() {},
      querySelectorAll: () => [],
    },
    location: {
      hostname: "example.com",
      pathname: "/",
      search: "",
      href: "https://example.com/",
    },
    chrome: { runtime: { sendMessage() {}, lastError: undefined } },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "content/bing-saves.js" });
  assert.ok(sandbox.__bingScraperTest, "El gancho de pruebas no se activó");
  return { helpers: sandbox.__bingScraperTest, sandbox };
}

const { helpers } = cargarScraper();

// Devuelve el código del scraper sin el bloque `const SEL = {...}` para poder
// comprobar que ningún selector literal se ha quedado fuera del objeto.
function codigoFueraDeSel(codigo) {
  const inicio = codigo.indexOf("const SEL = {");
  assert.ok(inicio >= 0, "No se encontró el objeto SEL");
  const cierre = codigo.indexOf("  };", inicio);
  assert.ok(cierre > inicio, "No se encontró el cierre del objeto SEL");
  return codigo.slice(0, inicio) + codigo.slice(cierre + "  };".length);
}

function tarjeta(contenido = {}) {
  return {
    url: "",
    title: "",
    text: "",
    thumbnailUrl: "",
    ...contenido,
  };
}

describe("Scraper de Bing Saves — tarjetas con card_refresh (fallo en vivo 2026-11-23)", () => {
  it("reconoce como tile de colección solo los enlaces internos de /saves", () => {
    assert.equal(
      helpers.esEnlaceDeColeccion("https://www.bing.com/saves?collId=abc123"),
      true
    );
    assert.equal(helpers.esEnlaceDeColeccion("https://www.bing.com/saves"), true);
  });

  it("NO descarta enlaces externos aunque la tarjeta tenga la clase card_refresh", () => {
    assert.equal(
      helpers.esEnlaceDeColeccion("https://www.ditig.com/yt-dlp-cheat-sheet/"),
      false
    );
    assert.equal(helpers.esEnlaceDeColeccion("https://minios.org/"), false);
  });
});

describe("Scraper de Bing Saves — selectores centralizados", () => {
  it("SEL contiene literalmente los selectores exigidos por el brief", () => {
    assert.equal(helpers.SEL.collection, '.collection, [role="tab"].collection');
    assert.equal(helpers.SEL.card, ".card");
    assert.equal(helpers.SEL.refreshCard, ".card.card_refresh");
    assert.equal(helpers.SEL.cardLink, "a.card__link");
    assert.equal(helpers.SEL.cardTitle, ".card__title");
    assert.equal(helpers.SEL.cardLabel, ".card__label");
    assert.equal(helpers.SEL.cardFootnote, ".card__footnote");
  });

  it("SEL centraliza thumb, activeTab y signInLink (sin literales fuera de él)", () => {
    assert.equal(helpers.SEL.thumb, "img[src]");
    assert.equal(
      helpers.SEL.activeTab,
      '[role="tab"].collection[aria-selected="true"], .collection[aria-selected="true"], .collection[aria-current="page"]'
    );
    assert.equal(
      helpers.SEL.signInLink,
      'a[href*="login.live.com"], a[href*="login.microsoftonline"], a[href*="/signin"]'
    );

    const fuera = codigoFueraDeSel(source);
    for (const literal of [
      "img[src]",
      '[role="tab"].collection[aria-selected="true"]',
      '.collection[aria-current="page"]',
      'href*="login.live.com"',
      'href*="login.microsoftonline"',
      'href*="/signin"',
    ]) {
      assert.ok(!fuera.includes(literal), `Selector literal fuera de SEL: ${literal}`);
    }
  });

  it("enPaginaSaves solo acepta hostname bing.com y ruta /saves", () => {
    const { helpers: locales, sandbox } = cargarScraper();
    const es = locales.enPaginaSaves;
    assert.equal(es(), false);
    sandbox.location.hostname = "www.bing.com";
    sandbox.location.pathname = "/saves";
    assert.equal(es(), true);
    sandbox.location.hostname = "cn.bing.com";
    assert.equal(es(), true);
    sandbox.location.hostname = "evilbing.com";
    assert.equal(es(), false);
    sandbox.location.hostname = "www.bing.com";
    sandbox.location.pathname = "/search";
    assert.equal(es(), false);
  });
});

describe("Scraper de Bing Saves — conversión de tarjetas", () => {
  it("tarjeta con enlace http(s) produce un ítem page con título y miniatura", () => {
    const item = helpers.cardToItem(
      tarjeta({
        url: "https://www.example.com/home",
        title: "Home office setup",
        text: "example.com\nGuardado el 12/11",
        thumbnailUrl: "https://img.example.com/home.jpg",
      })
    );
    assert.equal(item.type, "page");
    assert.equal(item.title, "Home office setup");
    assert.equal(item.url, "https://www.example.com/home");
    assert.equal(item.thumbnailUrl, "https://img.example.com/home.jpg");
    assert.ok(item.text.includes("Guardado el 12/11"));
    assert.ok(!("thumbnailData" in item));
  });

  it("sin URL pero con texto produce una nota (se importa, NO cuenta como skipped)", () => {
    const item = helpers.cardToItem(
      tarjeta({ title: "Nota sin enlace", text: "Comprar café y filtros" })
    );
    assert.equal(item.type, "note");
    assert.equal(item.url, "");
    assert.equal(item.text, "Comprar café y filtros");
  });

  it("sin URL pero con miniatura produce una imagen con thumbnailUrl como cadena", () => {
    const item = helpers.cardToItem(
      tarjeta({ thumbnailUrl: "https://img.example.com/solo.png" })
    );
    assert.equal(item.type, "image");
    assert.equal(item.url, "");
    assert.equal(typeof item.thumbnailUrl, "string");
    assert.ok(!("thumbnailData" in item));
  });

  it("tarjeta realmente vacía devuelve null (solo ahí se cuenta como skipped)", () => {
    assert.equal(helpers.cardToItem(tarjeta()), null);
    assert.equal(helpers.cardToItem(tarjeta({ text: "   " })), null);
  });

  it("URLs no http(s) (javascript:, data:, #) no se importan como enlace", () => {
    assert.equal(helpers.cardToItem(tarjeta({ url: "javascript:alert(1)" })), null);
    assert.equal(helpers.cardToItem(tarjeta({ url: "data:text/html,x" })), null);
    assert.equal(helpers.cardToItem(tarjeta({ url: "#", title: "X" })).type, "note");
  });

  it("absoluteUrl resuelve relativas y rechaza esquemas no http al validar", () => {
    const base = "https://www.bing.com/saves?id=x";
    assert.equal(
      helpers.absoluteUrl("/saves?id=y", base),
      "https://www.bing.com/saves?id=y"
    );
    assert.equal(helpers.isValidHttpUrl("data:image/png;base64,AA", base), false);
    assert.equal(helpers.isValidHttpUrl("https://img.example.com/a.jpg", base), true);
  });
});

describe("Scraper de Bing Saves — ensamblado del payload", () => {
  const paginaA = { type: "page", title: "A", url: "https://a.example.com/1" };
  const paginaB = { type: "page", title: "B", url: "https://b.example.com/2" };
  const paginaC = { type: "page", title: "C", url: "https://c.example.com/3" };
  const nota = { type: "note", title: "Nota", url: "", text: "Texto de la nota" };

  it("emite la raíz primero, con rootName coherente", () => {
    const payload = helpers.buildPayload("Guardados", [
      { name: "Guardados", items: [paginaA, nota], skipped: 0 },
      { name: "Investigación", items: [paginaB, paginaC], skipped: 0 },
    ]);
    assert.equal(payload.rootName, "Guardados");
    assert.equal(payload.collections[0].name, "Guardados");
    assert.equal(payload.collections[1].name, "Investigación");
  });

  it("deduplica la raíz contra colecciones con nombre y dentro de cada colección", () => {
    const payload = helpers.buildPayload("Guardados", [
      { name: "Guardados", items: [paginaA, paginaB, paginaB, nota], skipped: 0 },
      { name: "Investigación", items: [paginaB, paginaC, paginaC], skipped: 0 },
    ]);
    // Array.from crea el array en el ámbito del test (los del vm tienen otro
    // prototipo y deepStrictEqual los considera distintos).
    assert.deepEqual(
      Array.from(payload.collections[0].items, (i) => i.url),
      ["https://a.example.com/1", ""]
    );
    assert.deepEqual(
      Array.from(payload.collections[1].items, (i) => i.url),
      ["https://b.example.com/2", "https://c.example.com/3"]
    );
  });

  it("skipped es el total de las colecciones y no duplica tarjetas vacías", () => {
    const payload = helpers.buildPayload("Guardados", [
      { name: "Guardados", items: [nota], skipped: 1 },
      { name: "Investigación", items: [paginaB], skipped: 2 },
    ]);
    assert.equal(payload.skipped, 3);
    // La nota está en items; solo la tarjeta vacía se contó en skipped.
    assert.equal(payload.collections[0].items.length, 1);
  });

  it("dedupeCollection conserva name/skipped y no cuenta duplicados como skipped", () => {
    const col = helpers.dedupeCollection({
      name: "Investigación",
      items: [paginaB, paginaB],
      skipped: 1,
    });
    assert.equal(col.items.length, 1);
    assert.equal(col.skipped, 1);
    assert.equal(col.name, "Investigación");
  });
});

describe("Scraper de Bing Saves — verificación de la vista destino", () => {
  it("vistaCorresponde es true cuando la pestaña activa coincide", () => {
    assert.equal(
      helpers.vistaCorresponde("Investigación", {
        activa: "Investigación",
        search: "?id=inv",
      }),
      true
    );
    // Normaliza mayúsculas y espacios, igual que el resto de nombres.
    assert.equal(
      helpers.vistaCorresponde("Investigación", { activa: "  INVESTIGACIÓN  " }),
      true
    );
  });

  it("vistaCorresponde es false con otro nombre", () => {
    assert.equal(
      helpers.vistaCorresponde("Investigación", { activa: "Guardados", search: "?id=inv" }),
      false
    );
  });

  it("vistaCorresponde es false sin pestaña activa o sin nombre esperado", () => {
    assert.equal(helpers.vistaCorresponde("Investigación", { activa: "" }), false);
    assert.equal(helpers.vistaCorresponde("Investigación", {}), false);
    assert.equal(helpers.vistaCorresponde("Investigación", null), false);
    assert.equal(helpers.vistaCorresponde("", { activa: "Guardados" }), false);
  });

  it("un salto no confirmado se omite y se informa en español (análisis estático)", () => {
    assert.ok(source.includes("omitida (no se pudo abrir)"));
    assert.ok(source.includes("if (!confirmada)"));
    assert.ok(source.includes("omitidas.push(entrada.nombre)"));
    assert.ok(source.includes("payload.skipped += omitidas.length"));
    assert.match(source, /async function navegar[\s\S]*?return false;/);
  });
});

describe("Scraper de Bing Saves — detección de estado", () => {
  it("isLoginScreen detecta la pantalla sin sesión en varios idiomas", () => {
    assert.equal(helpers.isLoginScreen("Start collecting · Sign in", { hasCollections: false }), true);
    assert.equal(helpers.isLoginScreen("Empieza a recopilar · Inicia sesión", { hasCollections: false }), true);
    assert.equal(
      helpers.isLoginScreen("Start collecting", {
        hasCollections: false,
        hasSignInLink: true,
      }),
      true
    );
  });

  it("isLoginScreen no confunde una cuenta autenticada vacía con falta de sesión", () => {
    // Cuenta AAD: «Start collecting» sin enlace de acceso -> payload vacío.
    assert.equal(
      helpers.isLoginScreen("Start collecting", { hasCollections: false }),
      false
    );
    assert.equal(helpers.isLoginScreen("Sign in · Mis guardados", { hasCollections: true }), false);
    assert.equal(helpers.isLoginScreen("Mis guardados", { hasCollections: false }), false);
  });
});

describe("Scraper de Bing Saves — validación estática (R3)", () => {
  it("el fixture HTML contiene el marcado que consumen todos los selectores", () => {
    for (const fragmento of [
      'role="tab"',
      'class="collection',
      'class="card"',
      'class="card card_refresh"',
      'class="card__link"',
      'class="card__title"',
      'class="card__label"',
      'class="card__footnote"',
      "Ver más",
      "Start collecting",
      "Sign in",
      "img.example.com",
    ]) {
      assert.ok(fixtureHtml.includes(fragmento), `Falta en el fixture: ${fragmento}`);
    }
  });

  it("el scraper no usa fetch, cookies ni datos de miniatura, y es script clásico", () => {
    assert.ok(!/\bfetch\s*\(/.test(source), "No debe haber fetch()");
    assert.ok(!/document\.cookie/.test(source), "No debe leer cookies");
    assert.ok(!/thumbnailData/.test(source), "Nunca se incrustan bytes de imagen");
    assert.ok(!/\bimport\s+[^\n]*\bfrom\b/.test(source), "executeScript no admite ESM");
    assert.ok(!/\brequire\s*\(/.test(source), "No debe haber require()");
  });

  it("el scraper declara la comprobación de página, errores y mensajes esperados", () => {
    for (const fragmento of [
      "bing.com",
      "/saves",
      "WRONG_PAGE",
      "NO_LOGIN",
      "BING_PROGRESS",
      "BING_RESULT",
      "location.search",
      "aria-selected",
    ]) {
      assert.ok(source.includes(fragmento), `Falta en el scraper: ${fragmento}`);
    }
  });
});
