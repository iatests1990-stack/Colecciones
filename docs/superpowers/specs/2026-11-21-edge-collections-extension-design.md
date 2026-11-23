# Reimplementación de Microsoft Edge Collections como extensión Chromium

- Fecha: 2026-11-21
- Estado: **Borrador para aprobación**
- Alcance elegido: **Opción A — clon de alta fidelidad**

## 1. Intención y por qué

Microsoft retiró Collections de Edge: desde la v145 (2026) no se pueden añadir ítems y desde la v149 (4 de junio de 2026) la función desaparece por completo. La migración oficial solo conserva las URLs en Favoritos y, para cuentas personales, los datos en Bing Saves; imágenes, notas y texto seleccionado se pierden en ese proceso. El objetivo de este proyecto es devolver al navegador esa experiencia en forma de extensión, preservando el flujo original de captura, organización, exportación y —muy importante— la capacidad de importar lo que el usuario ya tenía guardado.

## 2. Investigación previa (resumen)

- Collections era una función interna del navegador. **Nunca existió una API pública de extensiones** (`chrome.collections`), por lo que una extensión debe reconstruir la experiencia con APIs genéricas.
- Estructura: colecciones → tarjetas/ítems, con encabezados para agrupar.
- Tipos de ítem: página web (con preview, favicon, título), enlace, imagen, texto seleccionado y nota del usuario.
- Captura: *Add current page*, menú contextual sobre página/enlace/imagen/texto, arrastrar y soltar al panel, *Add all tabs*, atajo de teclado y crear colección desde el menú de pestañas (nombre por defecto = fecha actual).
- Organización: reordenar arrastrando, editar título, borrar, ordenar (nombre/fecha de creación/uso reciente, asc/desc), *Open all*.
- Compartir/exportar: *Copy all*, copiar enlace, compartir colección o ítem, *Send to Excel/Word/OneNote/Pinterest*.
- Sincronización entre dispositivos mediante cuenta Microsoft, con reflejo en `bing.com/saves`.
- Almacenamiento local: base de datos `collectionsSQLite` en la carpeta `Collections` del perfil de Edge, con timestamps, historial de modificación, URLs de origen, orden y contenido (incluidas miniaturas).
- Con el tiempo Microsoft sustituyó la implementación nativa por una basada en web, lo que se asocia a la caída de uso previa a la retirada.
- **Bing Saves** (`bing.com/saves`, antes `edgeservices.bing.com/saves`) conserva las colecciones de cuentas personales (MSA), pero **no ofrece exportación oficial**. Existe una extensión open source (`alan8983/bing-collections-to-bookmarks`) que demuestra que es factible leerlas desde el DOM de la página autenticada, sin peticiones de red propias. Las cuentas AAD/empresa no aparecen allí.

Fuentes consultadas: soporte oficial de Microsoft, blog de ingeniería de Edge, documentación de extensiones de Chrome/Edge, análisis forenses de sincronización y los repositorios open source `Collections Plus` y `bing-collections-to-bookmarks`.

## 3. Metas, no-metas y anti-metas

### Metas
1. Panel lateral persistente que replique la experiencia de Collections.
2. Captura de páginas, enlaces, imágenes, texto seleccionado y notas mediante menú contextual, arrastrar y soltar, y atajos.
3. Organización: colecciones, encabezados, reordenación, edición, borrado, ordenación y apertura masiva.
4. Importación de datos antiguos de Edge desde **tres fuentes**: CSV de exportación, `collectionsSQLite` (si es viable) y la web de Microsoft (Bing Saves).
5. Exportación: CSV, Markdown, HTML, XLSX real, copiar todo/copiar enlace y backup/restauración JSON.
6. Persistencia local robusta, sin cuenta ni servidor propios.
7. Sincronización opcional entre dispositivos mediante un archivo en una carpeta que el usuario ya sincroniza.
8. Pruebas automatizadas de la lógica pura y verificación manual en navegador.

### No-metas
- Integración con Microsoft Account, Bing Saves u Office Online (no es posible desde una extensión sin credenciales propias).
- Ejecutarse en navegadores no Chromium ni en móvil.
- Replicar el panel nativo del navegador al nivel de chrome:// (una extensión no puede sustituir UI interna).

### Anti-metas (qué haría que esto fracase aunque "funcione")
- Perder datos del usuario durante una importación o una migración de esquema.
- Requerir un paso de compilación o dependencias de pago para usar la extensión.
- Que la interfaz sea tan distinta que el usuario no reconozca el flujo original.

## 4. Restricciones

- Manifest V3, service worker (sin DOM), permisos mínimos.
- `chrome.sidePanel` solo está disponible de forma fiable en Chromium ≥ 114 (Edge y Chrome verificados; Brave/Vivaldi/Opera problemáticos).
- `chrome.storage.local` con `unlimitedStorage` para imágenes en miniatura; cuotas de `storage.sync` (≈100 KB) insuficientes para este caso.
- El acceso a archivos del perfil de Edge solo puede hacerse mediante File System Access API con elección explícita del usuario; no hay acceso directo desde la extensión.
- La UI debe funcionar sin conexión.

## 5. Enfoques considerados

| Enfoque | Descripción | Compensaciones |
|---|---|---|
| **A — Clon de alta fidelidad (elegido)** | Panel completo con tarjetas, miniaturas, notas, imágenes, encabezados, drag & drop, ordenación, importación CSV/SQLite, exportación múltiple y sync opcional por archivo. | Máxima fidelidad y recuperación de datos antiguos; mayor superficie de bugs y más trabajo. |
| **B — Esencial (MVP)** | Guardar página/enlace/imagen/selección/nota, organizar y exportar CSV/JSON. | Rápido; deja fuera importación, Office y sync. |
| **C — Esencial + migración** | Como B, con importación y backup JSON; sync y Office en fases posteriores. | Equilibrio, pero no satisface un "clon fiel". |

Se elige **A** porque el usuario pidió explícitamente volver a implementar Collections, no solo un sustituto mínimo.

## 6. Diseño técnico (partes decididas)

### 6.1 Plataforma y estructura

- Extensión **Manifest V3** sin build step: HTML, CSS y JavaScript moderno (módulos ES donde aplique).
- Sin dependencias en tiempo de ejecución. El escritor de `.xlsx` se implementa en código propio (ZIP + XML, sin librerías).
- Estructura de archivos prevista:

```
manifest.json
background.js                 service worker: menús, atajos, captura, side panel
sidepanel/
  panel.html
  panel.css
  panel.js
content/
  extractor.js                extrae selección/imagen/enlace bajo el cursor
  bing-saves.js               escáner del DOM de bing.com/saves (importación web)
offscreen/
  offscreen.html
  offscreen.js                tareas de sincronización en segundo plano
lib/
  store.js                    modelo, CRUD, esquema, ajustes, historial
  capture.js                  lógica compartida de captura
  csv.js                      parser CSV tolerante + mapeador de export de Edge
  bingsaves.js                normalización del payload de Bing Saves y fusión en el store
  sqlite.js                   importador de collectionsSQLite (si viable)
  export.js                   CSV / Markdown / HTML / XLSX
  render.js                   Markdown / HTML / lista de enlaces
  xlsx.js                     escritor .xlsx sin dependencias
  image.js                    redimensionado y cacheo de imágenes
  sync.js                     sincronización por archivo (File System Access)
  i18n.js                     cadenas en español
icons/                        iconos PNG generados localmente
tests/                        pruebas de lógica pura con node:test
docs/                         este documento
```

### 6.2 Modelo de datos

```js
Collection = {
  id, name, createdAt, updatedAt,
  color,            // opcional, para identificación visual
  sortOrder,        // orden de la colección en la lista
  items: Item[],
  sections: Section[]
}

Section = { id, collectionId, title, order }

Item = {
  id, collectionId, sectionId | null,
  type: 'page' | 'link' | 'image' | 'text' | 'note',
  title, url, sourceUrl,
  text,             // contenido seleccionado o cuerpo de la nota
  annotation,       // comentario del usuario sobre el ítem
  faviconUrl,
  thumbnailUrl,     // referencia a la URL original
  thumbnailData,    // data URL redimensionada cuando no hay preview remoto
  createdAt, updatedAt,
  order
}

Settings = {
  theme: 'light' | 'dark' | 'system',
  defaultCollectionId,
  captureShortcut, sortMode, sortDirection,
  sync: { enabled, fileHandleName, lastSyncAt },
  autoFileRules: []
}
```

- **Representación canónica de la agrupación:** los objetos `Section`. No existen ítems de tipo `heading`; los encabezados son la representación visual de una sección. Esto evita duplicar lógica de ordenación, renderizado y mapeo de importación. (Decisión del autor, derivada de la revisión.)
- Todo se persiste en `chrome.storage.local` bajo una única clave raíz con versionado de esquema (`schemaVersion`) y migraciones. Los `FileSystemFileHandle` y los blobs grandes se guardan en IndexedDB, no en `storage.local`.
- Se mantiene un historial local con rollback (últimas N versiones) para proteger contra borrados accidentales.

### 6.3 Arquitectura de ejecución

- **background.js** (service worker): registra menús contextuales, atajos (`commands`), abre el side panel y gestiona la captura de pestañas. No ejecuta importación, exportación ni sincronización: el service worker puede terminarse en mitad de una operación larga y no tiene ventana para los selectores de archivos.
- **sidepanel/panel.js**: toda la UI y la orquestación de importar/exportar/sincronizar, porque los selectores de File System Access requieren una ventana y un gesto del usuario. Escucha `storage.onChanged`.
- **offscreen/**: documento offscreen para las tareas de sync en segundo plano una vez concedido el permiso sobre el archivo; mantiene el handle obtenido en el panel sin obligar a volver a elegirlo en cada sincronización.
- **content/extractor.js**: inyectado bajo demanda para obtener texto seleccionado, imagen o enlace bajo el cursor, metadatos (`og:image`, favicon) y para interceptar el arrastre (ver §6.4).
- Comunicación mediante `chrome.runtime.sendMessage` / `tabs.sendMessage`. IndexedDB almacena handles y blobs grandes. (Decisión del autor, derivada de la revisión.)

### 6.4 Flujos de captura

1. **Guardar página actual:** desde el panel o `Ctrl+Shift+S`; captura título, URL, favicon y thumbnail (screenshot local si la página no ofrece preview).
2. **Menú contextual:** clic derecho en página/enlace/imagen/texto → *Guardar en Colecciones* → elegir colección o crear una nueva al vuelo. Opciones adicionales: *Guardar selección como nota* y *Guardar selección como cita* (texto + enlace a la fuente + anotación).
3. **Arrastrar y soltar:** Chromium no entrega de forma fiable un drop HTML5 desde el contenido de la página a otro WebContents (el panel). Por tanto, un content script intercepta `dragstart` y muestra un **dock de destino flotante** inyectado en la página, pegado al borde donde está el panel; soltar sobre ese dock captura enlace/imagen/selección y lo envía a la extensión. El reordenado de tarjetas **dentro** del panel sí usa HTML5 nativo (mismo WebContents). (Decisión del autor, derivada de la revisión.)
4. **Todas las pestañas:** añade todas las pestañas de la ventana a la colección elegida, omitiendo duplicados.
5. **Deduplicación:** no se guarda dos veces la misma URL en la misma colección.

**Miniaturas (decisión del autor, derivada de la revisión).** `chrome.tabs.captureVisibleTab` solo funciona sobre la pestaña activa y activar pestañas en segundo plano sería intrusivo, así que **no se activarán pestañas**. Las miniaturas se obtienen, en este orden: (1) `og:image`/imagen destacada leída por el content script; (2) favicon; (3) tarjeta solo con enlace. La captura de pantalla local se usa únicamente en el guardado rápido de la pestaña activa cuando no hay imagen de metadatos. Esto requiere permiso de host `<all_urls>` para inyectar content scripts; si el usuario restringe el acceso a sitios, se degrada a tarjeta de enlace.

### 6.5 Interfaz

- Panel con dos vistas: lista de colecciones y detalle de colección (con navegación «atrás»).
- Cabecera con nombre editable, menú «⋯» (Compartir y más, Ordenar, Importar, Exportar, Ajustes), botón de anclar y botón de cerrar.
- Tarjetas con miniatura, título, dominio, metadatos y acciones (abrir, copiar enlace, editar, eliminar).
- Encabezados agrupadores arrastrables, igual que en el original.
- Barra inferior de acciones: *Añadir página*, *Añadir nota*, *Añadir imagen*, *Añadir todas las pestañas*.
- Temas claro/oscuro/sistema, fuentes del sistema, sin frameworks de UI.

### 6.6 Importación de datos de Edge

- **CSV de exportación (`collections_export.csv`):** formato verificado a partir de un fixture real del export de Edge: **plano, con cabecera `Collection,Title,URL`**, una fila por página agrupada por nombre de colección. El CSV **no contiene notas, imágenes ni miniaturas**, y el orden solo se infiere del orden de filas. Microsoft no publica un esquema formal y este ha variado entre versiones, así que el parser será tolerante: BOM, CRLF/LF, comillas y saltos de línea incrustados, delimitadores `,` y `;`, detección de columnas por cabecera (o heurística por contenido) y fallback a `[colección, título, URL]`. Es la ruta principal de recuperación.
- **Web de Microsoft / Bing Saves (`bing.com/saves`):** Microsoft no ofrece exportación oficial, pero las cuentas personales (MSA) conservan allí las colecciones. Se importarán **leyendo únicamente el DOM de la página en la que el usuario ya está autenticado**, con un content script inyectado bajo acción explícita del usuario. La extensión **no hace peticiones de red propias, no lee cookies y no toca datos de otras webs**. Técnica validada por `bing-collections-to-bookmarks`:
  - Identificación de la **colección raíz** de forma independiente del idioma (pestaña activa al cargar y vista que muestra tiles de carpeta).
  - Enumeración de subcolecciones mediante la unión de **tiles de carpeta** y **pestañas de la barra lateral**, incluidas las ocultas tras «ver más».
  - **Carga incremental por scroll** hasta que el número de tarjetas deje de crecer, y espera al cambio de vista antes de extraer cada colección.
  - Extracción de tarjetas con enlace `http(s)`, con título, URL y miniatura cuando el DOM la exponga; deduplicación interna y eliminación de los duplicados de la vista «guardados recientemente» que ya están en colecciones con nombre.
  - **Flujo en la extensión:** el panel abre (o reutiliza) la pestaña de Bing Saves → inyecta `content/bing-saves.js` → muestra progreso por colección → el scraper devuelve `{nombre, items[{titulo, url, miniatura}]}` → `lib/bingsaves.js` normaliza al mismo formato que el importador CSV → **vista previa y confirmación** antes de fusionar en el store.
  - **Notas e imágenes sueltas** (tarjetas sin URL http) se intentan importar como ítems `note`/`image` de forma **best-effort**; si el marcado de Bing no expone suficiente información se omiten y se informa del número exacto. La implementación de referencia las descarta, así que se trata de una mejora no garantizada.
  - Los **selectores se centralizan en un único objeto** para poder parchearlos si Bing cambia su HTML, y se detecta el estado «no autenticado» (pantalla de inicio «Start collecting») para pedir al usuario que inicie sesión y reintente.
  - **Límites:** solo cuentas MSA; dependiente del marcado actual de Bing; no cubre cuentas AAD. No requiere permisos nuevos porque el diseño ya solicita `<all_urls>`.

**Resoluciones adicionales sobre Bing Saves (decisiones del autor, derivadas de la segunda revisión):**

- **Prioridad y aislamiento:** la importación desde Bing Saves se mantiene como **requisito de primera clase** (criterio de aceptación), pero se implementa aislada en `content/bing-saves.js` + `lib/bingsaves.js` y con una entrada de UI propia. El plan incluye una **validación temprana** del scraper contra una cuenta MSA real (o contra HTML capturado si no se dispone de cuenta) antes de construir el resto del flujo. Si Bing cambia el marcado, se parchea el objeto de selectores sin tocar el store, el importador CSV ni la exportación.
- **Miniaturas:** el scraper solo devuelve `thumbnailUrl` como referencia. **No se hace `fetch()` de los bytes** ni se re-codifica vía canvas: las imágenes de Bing pueden ser cross-origin (taint), ligadas a la sesión y contrarias a la promesa de «sin peticiones de red propias». El panel las renderiza con `<img>` y, si fallan, cae a favicon o tarjeta de enlace. `thumbnailData` queda reservado para capturas locales de la pestaña activa, no para importaciones de Bing.
- **Jerarquía:** se ha verificado que Bing Saves es plano (vista raíz + colecciones; los «tiles de carpeta» apuntan a colecciones hermanas, no a subcarpetas). Cada colección se mapea a un `Collection` plano, sin cambios de esquema. Si apareciera anidación, se aplanaría con un prefijo en el nombre en lugar de introducir jerarquía en el modelo.
- **Estados de la cuenta:** (1) *sin sesión* → detectar la pantalla «Start collecting» y pedir al usuario que inicie sesión y reintente; (2) *autenticada con colecciones* → flujo normal; (3) *autenticada sin colecciones* → mensaje que cubre ambos casos: «No se encontraron colecciones. Si usas una cuenta de empresa o escolar, tus datos no están en Bing Saves; recupéralos desde el CSV o desde `collectionsSQLite`». No se intenta adivinar el tipo de cuenta leyendo la UI de Bing, por su fragilidad.
- **`collectionsSQLite`:** es la **única** fuente que puede recuperar notas, texto e imágenes de forma fiable cuando el usuario aún tiene el archivo. Se intentará leer con un parser SQLite en JavaScript embebido (sin build step) si el tamaño y la complejidad son razonables; en caso contrario se deja como fase 2 y se documenta cómo exportar el CSV. Esto se decide durante la implementación y se comunicará al usuario.
- La importación es **aditiva y transaccional**: nunca sobrescribe una colección existente sin confirmación, y muestra un resumen antes de aplicar.

### 6.7 Exportación y backup

- CSV (compatible con Excel), Markdown, HTML autocompartible, JSON de alta fidelidad y `.xlsx` real (una hoja por colección, celdas con enlaces).
- *Copiar todo* (texto + URLs) y *copiar enlace*.
- Restauración desde el JSON de backup, validando esquema antes de reemplazar.

### 6.8 Sincronización opcional

- Desactivada por defecto. Si se activa, el usuario elige un archivo `collections-sync.json` dentro de una carpeta sincronizada por su proveedor de nube. El selector se abre **desde el panel** (requiere ventana y gesto del usuario); el `FileSystemFileHandle` se persiste en IndexedDB para no volver a pedirlo, y el documento offscreen ejecuta las sincronizaciones posteriores. Si el navegador revoca el permiso, se pide al usuario que vuelva a seleccionar el archivo.
- Modelo push/pull con marca de tiempo y resolución de conflictos por «última modificación gana», con copia de seguridad del archivo remoto antes de sobrescribir.
- La extensión nunca envía datos a servidores propios.

### 6.9 Atajos y ajustes

- `Ctrl+Shift+Y` para abrir el panel (igual que Edge); `Ctrl+Shift+S` para guardar rápido; ambos reconfigurables desde `chrome://extensions/shortcuts`.
- Ajustes: tema, colección por defecto, ordenación, reglas de auto-clasificación por dominio/URL/título, y configuración de sync.

### 6.10 Pruebas

- Pruebas unitarias con `node:test` sobre lógica pura: parser CSV, mapper de importación, normalizador de payload de Bing Saves (con fixtures de ejemplo), exportadores, renderizado, escritor XLSX y reducciones del store. El escáner del DOM se verificará en navegador, no con tests unitarios.
- Verificación manual en Edge y Chrome mediante una checklist: instalar sin empaquetar, capturar cada tipo de ítem, importar CSV de ejemplo, **importar desde Bing Saves con sesión iniciada (incluyendo cuenta sin sesión, colecciones ocultas y cuentas con muchos elementos)**, exportar cada formato, reiniciar el navegador y comprobar persistencia.

## 7. Lo que queda para el builder

- Secuenciar la implementación en un plan ejecutable.
- Confirmar durante la implementación la viabilidad del importador SQLite sin build step; si no es viable, documentar la decisión y el fallback a CSV.
- Diseñar los iconos y las cadenas exactas de la interfaz.
- Crear fixtures de CSV basados en el esquema real observado (`Collection,Title,URL`), incluyendo variantes con BOM, `;`, comillas y saltos de línea incrustados, y archivos sin cabecera.
- Crear fixtures del payload de Bing Saves para probar el normalizador sin depender de la web.
- Implementar el dock de arrastre en el content script y verificarlo en Edge y Chrome.
- Implementar el scraper de Bing Saves y verificarlo contra una cuenta MSA real con colecciones, subcolecciones y tarjetas sin enlace.

## 8. Criterios de aceptación

1. La extensión se instala en Edge y Chrome en modo desarrollador sin compilación.
2. Se pueden crear colecciones y guardar los cinco tipos de ítem por menú contextual y arrastrar y soltar.
3. Se pueden importar colecciones desde un CSV de Edge de ejemplo (`Collection,Title,URL`), preservando colecciones y orden de filas; las notas y las imágenes se recuperan únicamente desde `collectionsSQLite` cuando ese importador esté disponible.
4. Se pueden importar colecciones desde Bing Saves con una cuenta MSA autenticada, con progreso, deduplicación, vista previa y con un informe de los ítems omitidos.
5. Se pueden exportar los seis formatos y el backup puede restaurarse.
6. Los datos sobreviven a un reinicio del navegador y la sync opcional funciona con un archivo local.
7. Las pruebas unitarias pasan y la checklist manual se completa sin pérdida de datos.

## 9. Resoluciones de la revisión previa al plan

| Pregunta del revisor | Resolución |
|---|---|
| ¿Funciona el drag & drop desde la página al panel? | No es fiable entre WebContents. Se sustituye por un dock flotante inyectado por content script; el reordenado interno del panel sigue siendo HTML5 nativo. |
| ¿Cómo se generan miniaturas de pestañas en segundo plano? | Sin activar pestañas: `og:image` → favicon → tarjeta de enlace; screenshot solo en guardado rápido de la pestaña activa. Requiere `<all_urls>`. |
| ¿Dónde se ejecutan import/export/sync y cómo se recuerda el archivo? | En el panel (selectores de archivo) y en un documento offscreen para sync; handle en IndexedDB. El service worker solo gestiona menús, atajos y pestañas. |
| ¿Cuál es el esquema real del CSV de Edge? | Verificado: `Collection,Title,URL`, plano, sin notas ni imágenes. Parser tolerante a variantes. |
| ¿`Section` o ítems `heading`? | `Section` es la representación canónica; se elimina el tipo `heading`. |
| ¿Importación desde la web de Microsoft? (nuevo requisito del usuario) | Cuarta fuente: scraper del DOM de Bing Saves con sesión del usuario, sin API, cookies ni peticiones propias; comparte el adaptador de importación del CSV; notas/imágenes best-effort con informe de omitidos; solo MSA. |
| ¿Es la ruta Bing un bloqueo de release? | Requisito de primera clase pero aislado en adapter + UI propios, con validación temprana y selectores centralizados; un cambio de Bing no afecta al resto. |
| ¿Se pueden persistir las miniaturas de Bing? | Solo como `thumbnailUrl`; sin fetch ni canvas por cross-origin/sesión y para respetar la privacidad. El panel cae a favicon/enlace si fallan. |
| ¿Hay anidación en Bing Saves? | No: vista raíz + colecciones hermanas. Modelo plano confirmado, sin cambio de esquema. |
| ¿Qué pasa con cuentas AAD autenticadas sin datos? | Estado explícito con mensaje que indica que Bing Saves solo cubre MSA y sugiere CSV/SQLite. |
