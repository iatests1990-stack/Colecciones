# Borradores de ficha de tienda — Colecciones

Sustituye `[NOMBRE DEL PUBLICADOR]`, `[TU_EMAIL@ejemplo.com]` y la URL de la
política de privacidad por tus datos reales antes de publicar.

## Datos comunes

- **Nombre:** Colecciones
- **Nombre corto / descripción del manifest:** Guarda páginas, imágenes y notas en colecciones locales, con panel lateral, importación y exportación.
- **Categoría sugerida:** Productividad / Herramientas de navegación (elige la que cada tienda ofrezca).
- **Idioma de la ficha:** Español. Añade después una versión en inglés si quieres ampliar alcance.
- **URL de privacidad:** la página publicada en `docs/privacy/index.html`.
- **Soporte:** `[TU_EMAIL@ejemplo.com]`.
- **Aviso recomendado en la ficha:** «No afiliado a Microsoft ni a Google.»

## Descripción larga (para ambas tiendas; > 250 caracteres)

```
Colecciones devuelve al navegador un panel lateral donde reunir todo lo que
guardas mientras navegas: páginas web, enlaces, imágenes, fragmentos de texto y
notas tuyas, organizados en colecciones y secciones.

Guarda la página actual con un clic o desde el menú contextual, arrastra un
enlace o una imagen al panel, añade todas las pestañas abiertas y reordena las
tarjetas arrastrándolas. Cada tarjeta conserva su título, su URL y una miniatura
cuando está disponible. Las notas y las citas con texto seleccionado se guardan
junto a la página que las originó.

Importa tus datos desde cuatro fuentes: el CSV que exportaba Edge, la base de
datos collectionsSQLite que queda en el perfil, tus colecciones de Bing Saves
(leyendo solo la página en la que has iniciado sesión) y un backup JSON de esta
misma extensión. Exporta a CSV, Markdown, HTML, XLSX, JSON o una lista de
enlaces, y restaura tu copia cuando quieras.

Tus datos se guardan únicamente en tu equipo. La extensión no envía información
a servidores propios, no usa analítica y solo accede a la página que tú decides
guardar. La sincronización entre dispositivos es opcional y se basa en un
archivo que tú colocas en tu carpeta de nube preferida.
```

## Propósito único (campo «Single purpose»)

```
Ofrecer un panel lateral para capturar páginas, enlaces, imágenes, fragmentos
de texto y notas, organizarlos en colecciones locales y recuperarlos mediante
importación y exportación.
```

## Justificación de permisos (copiar en el campo de cada tienda)

| Permiso | Justificación |
| --- | --- |
| `sidePanel` | Necesario para mostrar la interfaz lateral de Colecciones junto a la página. |
| `storage` | Guarda colecciones, secciones, notas y preferencias exclusivamente en el dispositivo del usuario. |
| `contextMenus` | Añade «Guardar en Colecciones» y las opciones de nota/cita al menú contextual del navegador. |
| `commands` | Registra los atajos para abrir el panel y guardar la página actual. |
| `scripting` | Inyecta bajo demanda el lector del elemento bajo el cursor y el dock de arrastre. |
| `<all_urls>` | Requerido para que esos scripts puedan leer solo la página, enlace o imagen que el usuario decide guardar; no se recopila navegación pasiva. |
| `offscreen` | Mantiene la sincronización opcional por archivo cuando el panel está cerrado. |
| `downloads` | Permite descargar los seis formatos de exportación y el backup JSON. |
| `unlimitedStorage` | Evita límites de cuota al guardar miniaturas locales en colecciones grandes. |

## Chrome Web Store — apartados específicos

- Cuenta de desarrollador con tarifa única de 5 USD y verificación en 2 pasos activada.
- Icono de la tienda: 128×128 px (ya está en `icons/icon128.png`).
- Al menos una captura de 1280×800 o 640×400 px (máximo 5).
- Opcional: vídeo de YouTube, tile pequeño 440×280 y marquesina 1400×560.
- Pestañas a rellenar: *Store listing*, *Privacy* (propósito, permisos, «No remote code», uso de datos y URL de privacidad) y *Distribution* (pública, todos los países).
- *Notes for testers*: explicar que la importación desde Bing Saves necesita una cuenta personal de Microsoft con sesión iniciada; el resto de funciones no requiere cuenta.
- Revisión: normalmente unos días, hasta varias semanas si se consideran permisos amplios.

## Microsoft Edge Add-ons — apartados específicos

- Registro gratuito en Partner Center con una cuenta Microsoft personal (MSA), tipo «Individual».
- Logo: 300×300 px recomendado (mínimo 128×128).
- Descripción: mínimo 250 caracteres (la de arriba cumple).
- Short description: la del manifest.
- Capturas opcionales: 640×480 o 1280×800 px, máximo 6.
- «Notes for certification»: mismo texto que las notas para Chrome.
- Certificación: hasta 7 días hábiles.
