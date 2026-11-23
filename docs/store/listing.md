# Ficha de tienda — Colecciones (solo Microsoft Edge Add-ons)

Datos finales listos para pegar en la ficha de **Microsoft Edge Add-ons**.
No está prevista la publicación en Chrome Web Store.

## Datos comunes

- **Nombre:** Colecciones
- **Nombre corto / descripción del manifest:** Guarda páginas, imágenes y notas en colecciones locales, con panel lateral, importación y exportación.
- **Categoría sugerida:** Productividad / Herramientas de navegación.
- **Idioma de la ficha:** Español. Añade después una versión en inglés si quieres ampliar alcance.
- **URL de privacidad:** `https://iatests1990-stack.github.io/Colecciones/`
- **Soporte:** `360422065+iatests1990-stack@users.noreply.github.com`
- **Aviso recomendado en la ficha:** «No afiliado a Microsoft.»

## Descripción larga (> 250 caracteres)

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

## Justificación de permisos

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

## Pasos en Partner Center (Microsoft Edge Add-ons)

1. Registro gratuito en Partner Center con cuenta Microsoft personal (MSA), tipo «Individual».
2. Subir `release/colecciones-1.0.zip`.
3. **Availability**: pública, todos los países.
4. **Properties**: nombre, descripción corta y categoría según los datos de arriba.
5. **Privacy**: propósito único, justificación de permisos y URL de la política de privacidad.
6. **Store listings**: descripción larga, logo 300×300 px recomendado (mínimo 128×128), capturas opcionales 640×480 o 1280×800 px (máximo 6).
7. **Notes for certification**: explicar que la importación desde Bing Saves necesita una cuenta personal de Microsoft con sesión iniciada; el resto de funciones no requiere cuenta.
8. **Publish** → certificación de hasta 7 días hábiles.
