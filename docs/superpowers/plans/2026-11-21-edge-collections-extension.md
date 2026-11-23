# Reimplementación de Edge Collections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir una extensión Manifest V3 para Edge/Chrome que reimplemente el panel de Collections, con captura y organización de páginas/imagenes/texto/notas, importación desde CSV, `collectionsSQLite` y Bing Saves, y exportación/backup.

**Architecture:** Módulos puros en `lib/` (modelo, CSV, Bing, render, export, XLSX, sync) verificables con `node:test`, sin dependencias. Un service worker gestiona menús, atajos y captura; el panel lateral posee la UI y orquesta import/export/sync; un documento offscreen mantiene la sincronización en segundo plano. El scraper de Bing y el extractor de contenido son content scripts aislados e inyectados bajo demanda.

**Tech Stack:** JavaScript ES modules, HTML/CSS nativos, Manifest V3, `chrome.sidePanel`/`storage`/`contextMenus`/`scripting`/`commands`/`offscreen`, File System Access API, IndexedDB, `node:test`, Python stdlib para generar iconos.

**Spec:** `docs/superpowers/specs/2026-11-21-edge-collections-extension-design.md`

## Global Constraints

- Manifest V3; Chromium ≥ 114; objetivos verificados: Microsoft Edge y Google Chrome.
- **Sin build step y sin dependencias en tiempo de ejecución.** Solo `node:test` para pruebas y Python stdlib para generar iconos.
- UI en español; temas claro/oscuro/sistema; fuentes del sistema; sin frameworks de UI.
- Permisos: `sidePanel`, `storage`, `contextMenus`, `commands`, `scripting`, `offscreen`, `downloads`, `unlimitedStorage`; `host_permissions: ["<all_urls>"]`.
- `side_panel.default_path` = `sidepanel/panel.html`; service worker = `background.js`.
- Datos en `chrome.storage.local` con `schemaVersion` y migraciones; **no usar `storage.sync`** (≈100 KB). `FileSystemFileHandle` y blobs grandes en IndexedDB.
- Atajos: `Ctrl+Shift+Y` abre el panel; `Ctrl+Shift+S` guardado rápido.
- Modelo: `Collection` plano; `Section` es la representación canónica de agrupación; **no existe tipo de ítem `heading`**. Tipos: `page|link|image|text|note`.
- CSV de Edge: **plano, cabecera `Collection,Title,URL`**, sin notas ni imágenes; parser tolerante (BOM, CRLF/LF, `,` y `;`, comillas y saltos incrustados, sin cabecera).
- Bing Saves: **solo DOM de la página autenticada**; sin API, sin cookies, sin `fetch()` de bytes; solo `thumbnailUrl` como referencia; con fallback a favicon/enlace.
- La importación es aditiva, con vista previa y confirmación; nunca sobrescribe sin confirmación.
- Archivos bajo `D:\Mis Programas\Colecciones`; el workspace inicialmente **no es repositorio git** (Task 1 lo inicializa).

## Review Focus

1. **Cambio del DOM de Bing / colecciones cargadas perezosamente** → el scraper debe unir tiles + rail, hacer scroll hasta estabilizar y reportar omitidos. Pin: Task 9 (validación con cuenta MSA real) y Task 4 (`normalizeBingPayload` con fixture que incluye colección raíz duplicada y tarjetas sin URL).
2. **Pérdida silenciosa de notas/imágenes al importar CSV** → la UI debe declarar explícitamente que el CSV solo trae páginas. Pin: Task 3 (`mapEdgeCsv` produce solo `type:'page'`) y Task 8 (checklist de copy de importación).
3. **Miniaturas de Bing caducas/cross-origin** → nunca romper la tarjeta: caer a favicon y luego a enlace. Pin: Task 7 (`pickThumbnail`), Task 8 (checklist `onerror`).
4. **Terminación del service worker en import/sync largos** → esas operaciones viven en el panel/offscreen, nunca en `background.js`. Pin: Task 11 (`mergeStates`), Task 8 (checklist de sync sin panel abierto).
5. **Duplicados al importar sobre colecciones existentes** → deduplicación por URL y confirmación previa. Pin: Task 2 (`addItem` dedupe), Task 4 (dedupe de raíz) y Task 8 (checklist de vista previa).

---

### Task 1: Cimentación, manifiesto, iconos y git

**Files:**
- Create: `package.json`, `manifest.json`, `tools/make_icons.py`, `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`, `tests/manifest.test.mjs`
- Initialize: repositorio git en la raíz; incluir en el primer commit el spec y el plan ya existentes.

**Interfaces:**
- Produces: `manifest.json` con la configuración exacta de Global Constraints; `npm test` = `node --test tests` descubre `tests/*.test.mjs`.

- [ ] **Step 1: Escribir el test fallido del manifiesto**

`tests/manifest.test.mjs` debe importar `node:assert/strict`, `node:test`, `node:fs` y verificar: `manifest_version === 3`; `permissions` contiene `sidePanel, storage, contextMenus, commands, scripting, offscreen, downloads, unlimitedStorage`; `host_permissions` contiene `<all_urls>`; `side_panel.default_path === 'sidepanel/panel.html'`; `background.service_worker === 'background.js'`; `commands['open-panel'].suggested_key.default === 'Ctrl+Shift+Y'`; `commands['quick-save'].suggested_key.default === 'Ctrl+Shift+S'`.

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test`
Expected: FAIL (`Cannot find module ... manifest.json` o archivo inexistente).

- [ ] **Step 3: Crear la estructura mínima**

`package.json` con `"scripts": {"test": "node --test tests"}` y sin `dependencies`. `manifest.json` con todos los campos del paso 1, `"name": "Colecciones"`, descripción corta y `icons` apuntando a los cuatro PNG. `tools/make_icons.py` usa solo `zlib` y `struct` para escribir PNG sólidos del color `#0f6cbd` en los cuatro tamaños; ejecutarlo para generar `icons/`. Crear directorios vacíos `sidepanel/`, `content/`, `offscreen/`, `lib/`, `tests/`, `fixtures/` con un `.gitkeep` donde haga falta. Ejecutar `git init`.

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

`git add . && git commit -m "feat: scaffold MV3 extension, manifest, icons and test harness"`

---

### Task 2: Modelo de datos y reducciones puras

**Files:**
- Create: `lib/store.js`, `tests/store.test.mjs`

**Interfaces:**
- Consumes: nada (módulo base).
- Produces: `SCHEMA_VERSION`, `createEmptyState()`, `uid(prefix)`, `createCollection(state,name,extra)`, `renameCollection(state,id,name)`, `deleteCollection(state,id)`, `addItem(state,collectionId,item)`, `updateItem(state,itemId,patch)`, `deleteItem(state,itemId)`, `moveItem(state,itemId,targetCollectionId,index)`, `createSection(state,collectionId,title)`, `assignItemToSection(state,itemId,sectionId)`, `sortCollections(state,mode,direction)`, `importIntoState(state,collections)`, `migrate(raw)`. Todas devuelven un estado nuevo (inmutables). `importIntoState` devuelve `{state, stats}` con `stats.added` y `stats.skipped`.

- [ ] **Step 1: Escribir los tests fallidos del store**

`tests/store.test.mjs` con casos:
- `createEmptyState()` → `schemaVersion === SCHEMA_VERSION`, `collections: []`, `settings.theme === 'system'`.
- `createCollection` añade una colección con `name`, `createdAt`, `updatedAt`, `items: []`, `sections: []`.
- `addItem` con `{type:'page',url:'https://a.test',title:'A'}` añade; una segunda llamada con la misma URL en la misma colección **no** añade (`state.collections[0].items.length === 1`).
- `addItem` con otra URL en otra colección sí añade (dedupe por colección).
- `createSection` + `assignItemToSection` → `item.sectionId === section.id` y no se crea ningún ítem de tipo `heading`.
- `moveItem` cambia `collectionId` y respeta `index`.
- `sortCollections(state,'name','desc')` ordena por nombre descendente.
- `importIntoState` sobre estado con una colección existente del mismo nombre añade ítems nuevos y omite duplicados; `stats.added + stats.skipped === número de ítems de entrada`.
- `migrate({schemaVersion:0,collections:[]})` devuelve estado con `schemaVersion === SCHEMA_VERSION`.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL (`Cannot find module '../lib/store.js'`).

- [ ] **Step 3: Implementar `lib/store.js`**

Implementar las firmas anteriores con actualización inmutable (`map`/`filter`/`spread`), `uid` con `crypto.randomUUID()` si está disponible y fallback local. `migrate` aplica migraciones secuenciales desde cualquier versión menor y rellena campos faltantes con valores por defecto. Sin `chrome` ni DOM: el módulo debe poder importarse en Node.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test`
Expected: PASS (todos los tests de store).

- [ ] **Step 5: Commit**

`git add lib/store.js tests/store.test.mjs && git commit -m "feat: pure collection store with dedupe and migrations"`

---

### Task 3: Parser y mapeador de CSV de Edge

**Files:**
- Create: `lib/csv.js`, `tests/csv.test.mjs`, `fixtures/collections_export.sample.csv`, `fixtures/csv_variants.sample.csv`

**Interfaces:**
- Consumes: nada.
- Produces: `parseCsv(text) -> string[][]`, `mapEdgeCsv(csvText, fallbackName) -> {collections:[{name, items:[{type:'page',title,url}]}], stats:{collections,pages,skipped}}`.

- [ ] **Step 1: Escribir los tests fallidos del CSV**

`fixtures/collections_export.sample.csv` con la cabecera exacta `Collection,Title,URL` y 6 filas: 3 de `Trip to Japan`, 2 de `Home Office`, 1 de `Reading List`.
`fixtures/csv_variants.sample.csv` con BOM, CRLF, delimitador `;`, un título entre comillas con coma y salto de línea incrustados.
Tests:
- `parseCsv` ignora BOM, respeta comillas dobles escapadas (`""`) y no produce filas vacías finales.
- `parseCsv` con `\r\n` y `\r` sueltos produce el mismo número de filas.
- `mapEdgeCsv` del fixture principal → 3 colecciones, 6 páginas, `stats.skipped === 0`, y el primer ítem es `{type:'page',title:'Tokyo neighborhood guide',url:'https://www.example.com/tokyo-guide'}`.
- `mapEdgeCsv` del fixture de variantes → reconoce `;` y el título con salto de línea.
- `mapEdgeCsv` sin cabecera y 3 columnas → usa `[colección, título, URL]`.
- `mapEdgeCsv` con una fila sin URL → `stats.skipped === 1`.
- **Review Focus #2:** todos los ítems devueltos tienen `type === 'page'` y ninguno contiene `text` ni `image` (el CSV no conserva notas ni imágenes).

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL (`Cannot find module '../lib/csv.js'`).

- [ ] **Step 3: Implementar `lib/csv.js`**

Parser de estado máquina para comillas, comas, CR/LF y BOM. `detectColumns` por regex sobre la cabecera (`collection|group|folder`, `url|link|address|href`, `title|name|text`), con heurística de «columna con más valores `http(s)://`» como respaldo. Agrupar filas por nombre de colección en orden de aparición; título vacío → hostname sin `www.`.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add lib/csv.js tests/csv.test.mjs fixtures && git commit -m "feat: tolerant Edge CSV parser and mapper"`

---

### Task 4: Normalizador del payload de Bing Saves

**Files:**
- Create: `lib/bingsaves.js`, `tests/bingsaves.test.mjs`, `fixtures/bing-saves.sample.json`

**Interfaces:**
- Consumes: payload `{rootName, collections:[{name, items:[{title,url,thumbnailUrl?,type?,text?}], skipped}], skipped}` producido por `content/bing-saves.js` (Task 9).
- Produces: `normalizeBingPayload(payload, fallbackName) -> {collections:[{name, items:[...]}], stats:{collections,items,skipped,duplicatesRemoved}}`, con ítems en el mismo formato que `mapEdgeCsv` (`type`, `title`, `url`, más `thumbnailUrl` y `text` cuando existan).

- [ ] **Step 1: Escribir los tests fallidos del normalizador**

`fixtures/bing-saves.sample.json`: `rootName: "Guardados"`, colección raíz con 2 enlaces (uno repetido en `Investigación`) y una tarjeta sin URL con texto; colección `Investigación` con 2 enlaces; `skipped: 1`.
Tests:
- Devuelve 2 colecciones (raíz + `Investigación`) y elimina el enlace duplicado de la raíz → `stats.duplicatesRemoved === 1`.
- La tarjeta sin URL con texto se convierte en `{type:'note', text:'...'}` y no se cuenta como `skipped`.
- La tarjeta sin URL y sin texto se omite e incrementa `stats.skipped`.
- Los `thumbnailUrl` se conservan como cadena y **no** se genera ningún campo `thumbnailData`.
- Con payload vacío y cuenta AAD simulada (`collections: []`, `rootName: ''`) → `stats.collections === 0` y `stats.skipped === 0` (la UI decidirá el mensaje, Task 8).

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL (`Cannot find module '../lib/bingsaves.js'`).

- [ ] **Step 3: Implementar `lib/bingsaves.js`**

Construir el conjunto de URLs de las colecciones con nombre; filtrar de la raíz las URLs ya presentes; deduplicar URLs dentro de cada colección; mapear tarjetas sin URL a `note` cuando tengan `text`, y a `image` cuando traigan `thumbnailUrl` sin enlace; propagar `skipped`. No importar `chrome`, no hacer red.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add lib/bingsaves.js tests/bingsaves.test.mjs fixtures && git commit -m "feat: normalize Bing Saves payload for import"`

---

### Task 5: Renderizado a Markdown, HTML y lista de enlaces

**Files:**
- Create: `lib/render.js`, `tests/render.test.mjs`

**Interfaces:**
- Consumes: colecciones del store (`{name, items}`).
- Produces: `toMarkdown(collections) -> string`, `toHtml(collections) -> string`, `toLinkList(collections) -> string`.

- [ ] **Step 1: Escribir los tests fallidos de render**

Usar dos colecciones con un `page`, un `note` y un `image`.
- `toMarkdown` contiene `## ` por colección, `[Título](https://...)` para páginas y el texto de la nota.
- `toHtml` empieza con `<!DOCTYPE html>`, es autocontenido (sin `src="http`), escapa `<script>` en títulos (`&lt;script&gt;`) e incluye enlaces `<a href=`.
- `toLinkList` devuelve una línea por URL con el formato `Título — URL`, sin notas.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implementar `lib/render.js`**

Generar cadenas con plantillas; escapar `&<>"'` en HTML; ordenar ítems por `order` si existe.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add lib/render.js tests/render.test.mjs && git commit -m "feat: markdown/html/link renderers"`

---

### Task 6: Exportación CSV, JSON y escritor XLSX

**Files:**
- Create: `lib/export.js`, `lib/xlsx.js`, `tests/export.test.mjs`, `tests/xlsx.test.mjs`

**Interfaces:**
- Consumes: estado del store y colecciones.
- Produces: `toCsv(collections) -> string`, `toJsonBackup(state) -> string`, `parseJsonBackup(text) -> state` (lanza si `schemaVersion` inválido), `crc32(bytes) -> number`, `buildXlsx(collections) -> Uint8Array`, `zipFiles(files) -> Uint8Array`.

- [ ] **Step 1: Escribir los tests fallidos de exportación**

`tests/export.test.mjs`:
- `toCsv` produce cabecera `Collection,Title,URL` y una fila por página; un título con coma se emite entre comillas; las notas no se incluyen como filas de URL.
- `toJsonBackup(state)` → `parseJsonBackup` devuelve un estado deep-equal; un JSON con `schemaVersion: 999` hace que `parseJsonBackup` lance.
`tests/xlsx.test.mjs`:
- `crc32(Buffer.from('123456789')) === 0xCBF43926`.
- `zipFiles` devuelve bytes que empiezan por `PK\x03\x04` y terminan con el final de central directory `PK\x05\x06`.
- `buildXlsx` con 2 colecciones produce un ZIP que contiene `xl/workbook.xml` con dos `<sheet ` y `xl/worksheets/sheet1.xml` con `t="inlineStr"`; verificarlo buscando esas cadenas en el buffer decodificado como latin1.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implementar `lib/export.js` y `lib/xlsx.js`**

CSV con escape RFC 4180. XLSX: writer ZIP store (sin compresión) con CRC32 propio, `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheetN.xml` y celdas con hipervínculo. Sin dependencias.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add lib/export.js lib/xlsx.js tests && git commit -m "feat: CSV/JSON/XLSX exporters without dependencies"`

---

### Task 7: Captura, extractor de contenido y service worker

**Files:**
- Create: `lib/capture.js`, `content/extractor.js`, `background.js`, `tests/capture.test.mjs`

**Interfaces:**
- Consumes: `addItem`, `createCollection` de Task 2.
- Produces: `pickThumbnail({ogImage, firstImage, favicon, pageUrl}) -> string|null`, `buildCapturedItem({url,title,selection,linkUrl,imageUrl,ogImage,favicon}) -> item`; mensajes `OPEN_PANEL`, `SAVE_PAGE`, `SAVE_ALL_TABS`, `EXTRACT_CONTEXT`, `INJECT_BING_SCRAPER`; contexto extraído `{url,title,selection,linkUrl,imageUrl,ogImage,favicon}`.

- [ ] **Step 1: Escribir los tests fallidos de captura**

`tests/capture.test.mjs`:
- `pickThumbnail` prioriza `ogImage`, luego `firstImage`, luego `favicon`, y devuelve `null` si no hay nada.
- `pickThumbnail` ignora URLs relativas y `data:` grandes; devuelve solo `http(s)://...` absoluta.
- **Review Focus #3:** `buildCapturedItem` con `ogImage` cross-origin devuelve `thumbnailUrl` y **nunca** `thumbnailData`.
- `buildCapturedItem` con `selection` produce `type:'text'` y `text` con la selección; con `imageUrl` produce `type:'image'`.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implementar captura, extractor y background**

`lib/capture.js` con las firmas anteriores. `content/extractor.js`: script autoejecutable que responde a `{type:'EXTRACT_CONTEXT'}` leyendo `window.getSelection()`, `document.querySelector('meta[property="og:image"]')`, `<link rel="icon">`, y el elemento bajo el cursor del menú contextual. `background.js`: registra menús «Guardar en Colecciones», «Guardar selección como nota», «Guardar selección como cita»; registra `commands` `open-panel` y `quick-save`; `sidePanel.setPanelBehavior({openPanelOnActionClick:true})`; en `SAVE_PAGE` usa `chrome.tabs.query` + `buildCapturedItem`; en `SAVE_ALL_TABS` itera pestañas de la ventana; en `INJECT_BING_SCRAPER` usa `chrome.scripting.executeScript({files:['content/bing-saves.js']})` sobre la pestaña indicada. El service worker **no** ejecuta import/export/sync.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test`
Expected: PASS (Solo lógica pura; el comportamiento de menús se comprueba en Task 12).

- [ ] **Step 5: Commit**

`git add lib/capture.js content/extractor.js background.js tests/capture.test.mjs && git commit -m "feat: capture pipeline, content extractor and service worker"`

---

### Task 8: Panel lateral y orquestación de UI

**Files:**
- Create: `sidepanel/panel.html`, `sidepanel/panel.css`, `sidepanel/panel.js`, `lib/i18n.js`

**Interfaces:**
- Consumes: todas las firmas de Tasks 2–7; `normalizeBingPayload`, `mergeStates` (Task 11).
- Produces: UI funcional; mensajes al background; flujo de importación con **vista previa y confirmación** antes de `importIntoState`.

- [ ] **Step 1: Crear la estructura y las cadenas**

`lib/i18n.js` exporta `t(key, params)` con un diccionario plano en español que incluye, literalmente: `import.bing.empty` = «No se encontraron colecciones. Si usas una cuenta de empresa o escolar, tus datos no están en Bing Saves; recupéralos desde el CSV o desde collectionsSQLite»; `import.csv.notice` = «El CSV solo contiene páginas: las notas y las imágenes no se pueden recuperar de él»; `import.preview` = «Se importarán {n} colecciones y {m} elementos».

- [ ] **Step 2: Implementar la UI y verificar en navegador**

`sidepanel/panel.html/.css/.js`: dos vistas (lista de colecciones y detalle), tarjetas con miniatura/título/dominio, encabezados desde `Section`, barra inferior *Añadir página / Nota / Imagen / Todas las pestañas*, menú «⋯» con Ordenar, Importar (CSV / Bing Saves / SQLite / JSON), Exportar (CSV / Markdown / HTML / XLSX / JSON) y Ajustes. Reordenar tarjetas con HTML5 nativo dentro del panel. Temas claro/oscuro/sistema. Conectar `storage.onChanged`.

Checklist manual (Edge):
- [ ] Instalar sin empaquetar desde `edge://extensions` y abrir con `Ctrl+Shift+Y`.
- [ ] **Review Focus #2:** abrir Importar CSV y comprobar que aparece `import.csv.notice` antes de importar.
- [ ] **Review Focus #3:** forzar una miniatura rota y comprobar que la tarjeta cae a favicon y luego a enlace sin romperse.
- [ ] **Review Focus #5:** importar sobre una colección existente y comprobar que la vista previa muestra el número correcto y que no se duplican URLs tras confirmar.
- [ ] **Review Focus #4:** activar sync, cerrar el panel, esperar y comprobar que el documento offscreen sigue sincronizando.

- [ ] **Step 3: Commit**

`git add sidepanel lib/i18n.js && git commit -m "feat: side panel UI and import/export orchestration"`

---

### Task 9: Scraper de Bing Saves y validación en vivo

**Files:**
- Create: `content/bing-saves.js`
- Modify: `background.js` (mensaje `INJECT_BING_SCRAPER` ya previsto en Task 7), `sidepanel/panel.js` (botón de importación)

**Interfaces:**
- Consumes: `normalizeBingPayload` (Task 4).
- Produces: mensajes `{type:'BING_PROGRESS', current, total, name}` y `{type:'BING_RESULT', payload}` con el payload descrito en Task 4.

- [ ] **Step 1: Implementar el scraper aislado**

`content/bing-saves.js` se autoejecuta solo si `location.hostname` termina en `bing.com` y `location.pathname` contiene `/saves`; si no, envía `{type:'BING_RESULT', payload:null, error:'WRONG_PAGE'}`. Objeto `SEL` centralizado con `.collection, [role="tab"].collection`, `.card`, `.card.card_refresh`, `a.card__link`, `.card__title`, `.card__label`, `.card__footnote`. Obtener raíz de la pestaña activa al cargar; unir tiles + rail; hacer scroll hasta estabilizar el número de tarjetas; visitar cada colección esperando cambio de `location.search` y estabilización; extraer `a.card__link` y título; tarjetas sin URL → `text` o `thumbnailUrl`; deduplicar raíz contra colecciones con nombre. Enviar progreso por colección y el payload final. Sin `fetch`, sin cookies.

- [ ] **Step 2: Validar contra la cuenta MSA del usuario**

Run: abrir `https://www.bing.com/saves` con la cuenta personal, cargar la extensión sin empaquetar y pulsar *Importar desde Bing Saves*.
Expected: el panel muestra progreso por colección, el informe final coincide con el número de colecciones visibles, las colecciones ocultas tras «ver más» aparecen, y los ítems sin enlace se cuentan como omitidos o notas. **Review Focus #1:** si alguna colección no aparece, parchear solo `SEL` y repetir. Si Bing cambia el marcado, documentar el selector nuevo en el mismo archivo.

- [ ] **Step 3: Comprobar el estado sin sesión y AAD**

Cerrar sesión → Expected: mensaje «Inicia sesión en Bing con tu cuenta personal y vuelve a intentarlo». Con cuenta de empresa → Expected: `import.bing.empty` (Task 8).

- [ ] **Step 4: Commit**

`git add content/bing-saves.js sidepanel/panel.js background.js && git commit -m "feat: Bing Saves DOM importer with live validation"`

---

### Task 10: Importador de `collectionsSQLite`

**Files:**
- Create: `lib/sqlite.js`, `tests/sqlite.test.mjs`, `fixtures/edge-collections-sample.sqlite`

**Interfaces:**
- Consumes: nada.
- Produces: `readCollectionsSqlite(bytes) -> {collections:[{name, items:[...]}], stats}`; lanza `Error('NOT_A_SQLITE_DB')` si falta la cabecera `SQLite format 3\0`.

- [ ] **Step 1: Obtener el fixture y escribir los tests fallidos**

Descargar `fixtures/edge-collections-sample.sqlite` desde `raw.githubusercontent.com/rod-trent/Collections-Plus/main/fixtures/edge-collections-sample.sqlite` (36 KB, licencia MIT del proyecto de referencia; solo como fixture de prueba).
Tests:
- `readCollectionsSqlite` con `Buffer.from('basura')` lanza `NOT_A_SQLITE_DB`.
- Con el fixture devuelve al menos una colección con ítems no vacíos.
- Los ítems conservan `title`, `url` (cuando existe), `text` para notas y `thumbnailUrl`/`thumbnailData` cuando el registro los trae.
- El orden de los ítems respeta `collections_items_relationship.position`.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implementar el lector mínimo**

`lib/sqlite.js`: lector SQLite de solo lectura sin dependencias que entienda el formato de página (header, B-tree leaf/interior, celdas y registros con varints) suficiente para las tablas `collections`, `items` y `collections_items_relationship` de Edge. Extraer `source` embebido en JSON para obtener la URL. Si una tabla no existe, devolver colección vacía en lugar de fallar.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Conectar al panel y verificar en vivo**

Añadir la opción «Importar base de datos de Edge…» en `sidepanel/panel.js` usando el selector de archivos del panel; comprobar que el resumen muestra notas e imágenes recuperadas. Hacer commit: `git add lib/sqlite.js tests/sqlite.test.mjs fixtures sidepanel/panel.js && git commit -m "feat: import Edge collectionsSQLite without dependencies"`

---

### Task 11: Sincronización opcional por archivo

**Files:**
- Create: `lib/sync.js`, `offscreen/offscreen.html`, `offscreen/offscreen.js`, `tests/sync.test.mjs`
- Modify: `manifest.json`, `sidepanel/panel.js`

**Interfaces:**
- Consumes: estado del store.
- Produces: `syncPayload(state) -> {version, updatedAt, state}`, `mergeStates(local, remote, now) -> {state, conflict}`, `shouldPull(localMeta, remoteMeta) -> boolean`.

- [ ] **Step 1: Escribir los tests fallidos de sync**

- `syncPayload(state).version === SCHEMA_VERSION` y `updatedAt` es un número.
- `mergeStates` con remoto más reciente devuelve el remoto, `conflict === false`.
- `mergeStates` con local más reciente devuelve el local, `conflict === false`.
- `mergeStates` con la misma marca de tiempo pero contenido distinto → `conflict === true` y gana el local (última modificación gana con desempate local).
- `shouldPull({updatedAt:1},{updatedAt:2}) === true`; con marcas iguales, `false`.
- **Review Focus #4:** ninguna función de `lib/sync.js` usa `chrome` ni DOM (importable en Node).

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implementar sync, handle y offscreen**

`lib/sync.js` puro. En `sidepanel/panel.js`: el selector de archivo se abre solo desde el panel y guarda el `FileSystemFileHandle` en IndexedDB; si el navegador revoca el permiso, pedir al usuario que vuelva a elegir el archivo. En `offscreen/offscreen.js`: crear documento offscreen (declarado en el manifiesto) con `chrome.offscreen.createDocument({reasons:['BLOBS'], justification:'Sincronización del archivo de colecciones'})` y ejecutar pull/push periódico usando el handle guardado. Verificar que `offscreen` continúa en `permissions` tal como lo fijó Task 1.

- [ ] **Step 4: Ejecutar tests y verificar manualmente**

Run: `npm test`
Expected: PASS.
Manual: activar sync con un `collections-sync.json` local, cerrar el panel, modificar el archivo desde otro perfil o copia, esperar y comprobar que los cambios se adoptan sin duplicados.

- [ ] **Step 5: Commit**

`git add lib/sync.js offscreen manifest.json sidepanel/panel.js tests/sync.test.mjs && git commit -m "feat: optional file-based sync with offscreen worker"`

---

### Task 12: Verificación final, documentación y cierre

**Files:**
- Create: `README.md`, `tests/manual-checklist.md`
- Modify: ninguno (solo verificación)

**Interfaces:**
- Consumes: toda la extensión.
- Produces: documentación de instalación, alcance, limitaciones y checklist ejecutada.

- [ ] **Step 1: Ejecutar toda la batería automática**

Run: `npm test`
Expected: PASS (todos los tests de Tasks 1–11).

- [ ] **Step 2: Ejecutar la checklist manual en Edge y Chrome**

Verificar, como mínimo: instalación sin empaquetar; `Ctrl+Shift+Y`; guardar página, enlace, imagen, texto seleccionado y nota; arrastrar desde la página al dock y reordenar dentro del panel; importar CSV, Bing Saves (cuenta MSA real), SQLite y JSON; exportar los seis formatos y restaurar el backup; sincronización; persistencia tras reiniciar el navegador; sin pérdida de datos. Registrar resultados en `tests/manual-checklist.md`.

- [ ] **Step 3: Documentar**

`README.md` con instalación en `edge://extensions` y `chrome://extensions`, permisos y por qué (`<all_urls>` para extraer contenido y miniaturas), las cuatro fuentes de importación, los seis formatos de exportación, la limitación de Bing Saves (solo MSA, sin API, notas/imágenes best-effort), la limitación del CSV (solo páginas) y el modelo de privacidad (sin servidores propios).

- [ ] **Step 4: Commit final**

`git add README.md tests/manual-checklist.md && git commit -m "docs: installation, scope, limitations and manual verification"`

---

## Self-Review

- **Spec coverage:** §1–§9 cubiertos: investigación y restricciones (Global Constraints), metas (Tasks 1–11), no-metas (sin cuenta/servidor propios), modelo y Section canónico (Task 2), arquitectura (Tasks 7–8, 11), captura (Task 7), UI (Task 8), cuatro importaciones (Tasks 3, 4, 9, 10), exportación (Tasks 5–6), sync (Task 11), pruebas y criterios de aceptación (Task 12).
- **Step scan:** cada paso produce un único artefacto comprobable; las firmas y los valores exactos están fijados y los cuerpo de algoritmos se dejan al implementer salvo donde el formato de archivo lo exige.
- **Type consistency:** `collections[].items[]` usa `{type,title,url,text,thumbnailUrl}` en Tasks 3, 4, 7, 9, 10; `importIntoState` consume esa forma; `normalizeBingPayload` y `mapEdgeCsv` devuelven la misma estructura.
- **Review Focus:** los cinco riesgos están pinneados con tests/checklist en Tasks 2–9 y 11, y referenciados desde la sección Review Focus.
- **Proportion:** el plan fija decisiones e interfaces; no transcribe el código salvo en los formatos de archivo (CSV, XLSX, SQLite) donde el formato lo determina.
