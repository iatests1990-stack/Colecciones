# Colecciones

Reimplementación de Microsoft Edge Collections como extensión Chromium (Manifest V3), sin compilación ni dependencias en tiempo de ejecución. Recupera el flujo de captura, organización, importación y exportación de Collections después de su retirada de Edge, y permite recuperar los datos que ya tenías guardados.

El panel lateral reproduce las colecciones, tarjetas con miniatura, notas, secciones, reordenación por arrastre y ordenación. Todo se guarda localmente en el navegador: no hay cuenta ni servidor propios.

## Compatibilidad

- **Microsoft Edge** y **Google Chrome** (y otros navegadores Chromium que expongan `chrome.sidePanel`).
- **Chromium ≥ 114**: es la primera versión en la que `chrome.sidePanel` está disponible de forma fiable.
- Se recomienda probar en Edge y Chrome; Brave, Vivaldi y Opera pueden presentar problemas con el panel lateral.
- No se admite móvil ni navegadores no Chromium.
- La interfaz está en español y funciona sin conexión (offline).

## Instalación (sin empaquetar / modo desarrollador)

La extensión se carga directamente desde esta carpeta; no hay que compilar nada.

**En Microsoft Edge**

1. Abre `edge://extensions`.
2. Activa **Modo desarrollador** (interruptor en la esquina inferior izquierda).
3. Pulsa **Cargar desempaquetada** (*Load unpacked*).
4. Selecciona la carpeta raíz de esta extensión (la que contiene `manifest.json`).
5. Comprueba que aparece «Colecciones» y que no hay errores. Si haces cambios en el código, vuelve a pulsar el botón de recarga de la tarjeta de la extensión.

**En Google Chrome**

1. Abre `chrome://extensions`.
2. Activa **Modo desarrollador** (interruptor en la esquina superior derecha).
3. Pulsa **Cargar sin empaquetar** (*Load unpacked*).
4. Selecciona la misma carpeta raíz (con `manifest.json`).
5. Recarga la extensión desde su tarjeta tras cualquier cambio.

**Atajos de teclado**

- `Ctrl+Shift+Y` — abrir/cerrar el panel de Colecciones (el mismo atajo que Edge).
- `Ctrl+Shift+S` — guardar rápido la página actual.
- Ambos se pueden reconfigurar en `edge://extensions/shortcuts` / `chrome://extensions/shortcuts`.

**Uso básico**

- Botón de la extensión o `Ctrl+Shift+Y` para abrir el panel.
- Clic derecho en una página, enlace, imagen o texto seleccionado → *Guardar en Colecciones*, *Guardar selección como nota* o *Guardar selección como cita*.
- Arrastra un enlace/imagen/selección desde la página al **dock flotante** que aparece en el borde del panel; dentro del panel, arrastra las tarjetas para reordenarlas.
- Barra inferior: *Añadir página*, *Nota*, *Imagen* y *Todas las pestañas*.

## Permisos y por qué se piden

| Permiso | Motivo |
| --- | --- |
| `sidePanel` | Mostrar el panel lateral de Colecciones. |
| `storage` | Persistir colecciones, ítems, ajustes y estado con versionado de esquema. |
| `unlimitedStorage` | Guardar miniaturas e imágenes (las cuotas de `storage.sync`, ~100 KB, son insuficientes). |
| `contextMenus` | Registrar *Guardar en Colecciones*, *Guardar selección como nota* y *Guardar selección como cita*. |
| `commands` | Registrar los atajos `Ctrl+Shift+Y` y `Ctrl+Shift+S`. |
| `scripting` | Inyectar bajo demanda el extractor de contexto, el lector del DOM de Bing Saves y el dock de arrastre. |
| `offscreen` | Mantener la sincronización por archivo con el panel cerrado, mediante un documento offscreen. |
| `downloads` | Guardar los archivos exportados (CSV, Markdown, HTML, XLSX, JSON). |
| `<all_urls>` (host permission) | Necesario para inyectar el content script en cualquier página y extraer el texto seleccionado, el enlace o la imagen, y leer metadatos (`og:image`, favicon) para generar miniaturas. Si limitas el acceso a sitios, la extensión degrada a tarjetas de solo enlace. |

`<all_urls>` es el permiso más amplio y merece una aclaración: la extensión **no envía lo que lee a ningún servidor**. Solo se usa localmente, dentro de la pestaña, para construir la tarjeta que tú guardas. Lee el DOM de la página activa cuando tú ejecutas una acción (guardar, arrastrar, importar desde Bing Saves); no lee cookies ni tráfico de red.

## Importación (cuatro fuentes)

Todas las importaciones son **aditivas**: se muestra una vista previa con el número de colecciones/elementos y se confirma antes de fusionar en el estado; nunca se sobrescribe una colección existente sin confirmación.

1. **CSV de Edge** (`collections_export.csv`) — ruta principal de recuperación. Parser tolerante: BOM, CRLF/LF, delimitadores `,` y `;`, comillas y saltos de línea incrustados, detección de cabecera en inglés/español (`Collection,Title,URL`) y fallback posicional. **Limitación: el CSV solo contiene páginas**; no incluye notas, imágenes ni miniaturas, y el orden solo se infiere del orden de filas.
2. **Bing Saves** (`bing.com/saves`) — lee únicamente el DOM de la página en la que ya has iniciado sesión, previa acción explícita. Progreso por colección, deduplicación, vista previa e informe de elementos omitidos. Ver limitaciones más abajo.
3. **`collectionsSQLite` de Edge** — lector SQLite embebido, de solo lectura y sin dependencias, del archivo `collectionsSQLite` de la carpeta `Collections` del perfil de Edge. Es la **única fuente que recupera de forma fiable notas, texto seleccionado e imágenes** (miniaturas incluidas) cuando aún conservas el archivo. No modifica el archivo de entrada; un archivo dañado o incompatible se informa como error, no como importación vacía.
4. **Backup JSON** — restaura un archivo exportado por esta extensión. Valida la versión de esquema antes de reemplazar el estado; un JSON mal formado o de versión incompatible se rechaza. Está disponible en *Ajustes → Restaurar copia de seguridad JSON…*.

## Exportación (seis formatos)

En el menú **⋯ → Exportar**:

1. **CSV** (`Collection,Title,URL`, RFC 4180) — compatible con Excel. Solo páginas/enlaces/imágenes con URL; las notas no generan filas.
2. **Markdown** — `## Colección` y `[Título](URL)`, con notas e imágenes.
3. **HTML** — documento autocompartenido, sin recursos remotos, con enlaces y texto escapado.
4. **XLSX** — libro real con una hoja por colección y celdas con hipervínculos, generado sin librerías externas; se abre en Excel y LibreOffice.
5. **JSON** — backup de alta fidelidad del estado (con `schemaVersion`), restaurable desde Ajustes.
6. **Copiar enlaces** — copia al portapapeles la lista `Título — URL` de todos los ítems (sin notas).

## Limitaciones de Bing Saves

- **Solo cuentas personales (MSA).** Las cuentas de empresa/escuela (AAD) no aparecen en Bing Saves; para esos datos usa el CSV o `collectionsSQLite`. Cuando no hay colecciones se muestra un aviso específico.
- **Sin API oficial.** Microsoft no ofrece exportación de Bing Saves; la importación lee el DOM actual de la página autenticada. Si Bing cambia su marcado, puede ser necesario actualizar el objeto de selectores (centralizado en `content/bing-saves.js`).
- **Notas e imágenes, best-effort.** Las tarjetas sin URL se intentan importar como nota/imagen, pero dependen del marcado de Bing: si no expone suficiente información se omiten y se informa del número exacto de elementos omitidos.
- **Miniaturas como referencia.** Solo se conserva `thumbnailUrl`; no se descargan bytes de imágenes (pueden ser cross-origin o depender de la sesión). Si la imagen no carga, el panel cae a favicon o a tarjeta de enlace.
- Sin sesión iniciada se detecta la pantalla de acceso y se pide iniciar sesión y reintentar; la importación tiene un límite de tiempo y permite reintentar.

## Privacidad

- **Sin servidores propios.** La extensión nunca envía tus datos a un servidor controlado por este proyecto.
- **Sin cookies.** No lee cookies de Bing ni de ningún otro sitio.
- **Sin peticiones de red propias.** No usa `fetch`, `XMLHttpRequest`, `WebSocket` ni `sendBeacon` para enviar datos. La importación de Bing Saves solo lee el DOM de la página en la que tú has iniciado sesión; no llama a APIs de Microsoft.
- **Datos locales.** Todo se guarda en `chrome.storage.local` y en IndexedDB (solo los handles de archivo y blobs grandes), dentro de tu perfil del navegador.
- **Sincronización opcional por archivo.** Desactivada por defecto. Si la activas, tú eliges un archivo `.json` en una carpeta que ya sincroniza tu proveedor de nube; el handle se guarda en IndexedDB y un documento offscreen mantiene la sync incluso con el panel cerrado y tras reiniciar el navegador. La extensión no contacta con el proveedor de nube: solo lee/escribe ese archivo local. Resolución de conflictos por «última modificación gana», con copia del archivo remoto antes de sobrescribirlo.

## Desarrollo y pruebas

```bash
npm test        # node --test tests  (sin dependencias)
```

Las pruebas cubren la lógica pura (parser/mapper CSV, normalizador de Bing Saves, exportadores y renderizado, escritor XLSX, store, sync y manifest). Las comprobaciones que requieren navegador e inicio de sesión están en [`tests/manual-checklist.md`](tests/manual-checklist.md).

## Estructura

```
manifest.json       Manifiesto MV3 (permisos, side panel, service worker, atajos)
background.js       Service worker: menús, atajos, captura, panel y arranque de sync
sidepanel/          Interfaz del panel (HTML/CSS/JS)
content/            extractor.js, bing-saves.js y drag-dock.js (content scripts)
offscreen/          Documento offscreen para la sincronización por archivo
lib/                Lógica pura: store, capture, csv, bingsaves, sqlite, export,
                    render, xlsx, sync, i18n
icons/              Iconos PNG (16/32/48/128)
fixtures/           Ejemplos de CSV, payload de Bing y base SQLite para pruebas
tests/              Batería de node:test y checklist manual
tools/              Generador de iconos
docs/               Especificación y plan de diseño
```
