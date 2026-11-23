# Checklist de verificación manual — Colecciones

Complemento de la batería automática (`npm test`). Todas las comprobaciones
requieren navegador. Ejecuta cada apartado en Edge y Chrome cuando aplique y
registra navegador, versión, fecha y resultado (✅/❌ + nota).

## 1. Instalación y panel

- [ ] Instalar sin empaquetar en `edge://extensions` y en `chrome://extensions` con el modo desarrollador activado. Esperado: la extensión aparece sin errores.
- [ ] Abrir el panel desde el botón de la barra. Esperado: se abre el panel lateral con la interfaz en español.
- [ ] Verificar los atajos configurados en `chrome://extensions/shortcuts` / `edge://extensions/shortcuts`. Esperado: atajos registrados y reasignables.
- [ ] Guardar rápido la página actual. Esperado: aparece una tarjeta nueva sin duplicados.

## 2. Guardado de los cinco tipos de ítem

- [ ] Añadir página, enlace, imagen, texto seleccionado como nota y como cita.
- [ ] Guardar la misma URL dos veces en la misma colección. Esperado: no se duplica.
- [ ] Usar «Todas las pestañas». Esperado: se añaden las pestañas http(s), sin activar pestañas en segundo plano.

## 3. Arrastrar al dock y reordenar

- [ ] Arrastrar un enlace, una imagen y texto seleccionado al dock flotante.
- [ ] Reordenar tarjetas dentro del panel y moverlas a otra colección o sección.
- [ ] Crear una sección y eliminarla. Esperado: la cabecera desaparece y sus ítems quedan visibles sin sección.

## 4. Importación (cuatro fuentes)

- [ ] CSV de Edge (con y sin cabecera, BOM, `;`, comillas y saltos de línea, filas sin URL).
- [ ] `collectionsSQLite` de Edge (válido, corrupto y no SQLite).
- [ ] Bing Saves con una cuenta personal autenticada: progreso, vista previa, deduplicación y recuento de omitidos.
- [ ] Bing Saves sin sesión y con cuenta de empresa: mensaje explicativo, sin diálogo colgado.
- [ ] Backup JSON de la propia extensión (válido y mal formado).

## 5. Exportación (seis formatos) y restauración

- [ ] CSV, Markdown, HTML, XLSX, JSON y copiar enlaces.
- [ ] Abrir el XLSX resultante en Microsoft Excel y en LibreOffice Calc.
- [ ] Borrar una colección y restaurar el backup JSON. Esperado: se recupera el estado exacto.

## 6. Sincronización por archivo y persistencia

- [ ] Activar la sincronización y elegir un archivo local. Esperado: se crea el documento offscreen y se escribe el archivo.
- [ ] Cerrar el panel y esperar el intervalo. Esperado: el archivo se actualiza igualmente.
- [ ] Reiniciar el navegador con la sync activa y el panel cerrado. Esperado: continúa sin volver a elegir el archivo.
- [ ] Forzar un conflicto (mismas marcas, contenido distinto). Esperado: se informa del conflicto y se ofrece la copia del archivo remoto antes de sobrescribir.
- [ ] Reiniciar sin sync y comprobar que persisten colecciones, ítems, secciones, notas y ajustes.

## 7. Integridad de datos

- [ ] Recorrer el flujo completo y comprobar que no se pierde ningún dato.
- [ ] Verificar en DevTools que no se realizan peticiones de red propias durante el uso normal ni en la importación de Bing Saves.

## Tabla de resultados

| Apartado | Navegador / versión | Fecha | ✅/❌ | Notas |
| --- | --- | --- | --- | --- |
| 1. Instalación y panel | | | | |
| 2. Guardado de ítems | | | | |
| 3. Dock y reordenado | | | | |
| 4. Importación | | | | |
| 5. Exportación y restauración | | | | |
| 6. Sync y persistencia | | | | |
| 7. Integridad de datos | | | | |
