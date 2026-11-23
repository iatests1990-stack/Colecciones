// lib/i18n.js
// Diccionario plano en español para el panel lateral. Sin dependencias ni
// globals de navegador: se importa igual en Node (tests) que en la extensión.

const CADENAS = {
  "app.title": "Colecciones",
  "nav.back": "Atrás",
  "menu.more": "Más opciones",
  "menu.sort": "Ordenar",
  "menu.import": "Importar",
  "menu.import.csv": "CSV…",
  "menu.import.bing": "Bing Saves…",
  "menu.import.sqlite": "Importar base de datos de Edge…",
  "menu.import.json": "JSON…",
  "menu.export": "Exportar",
  "menu.export.csv": "CSV…",
  "menu.export.markdown": "Markdown…",
  "menu.export.html": "HTML…",
  "menu.export.xlsx": "XLSX…",
  "menu.export.json": "JSON…",
  "menu.export.copy": "Copiar enlaces",
  "menu.settings": "Ajustes",
  "action.addPage": "Añadir página",
  "action.note": "Nota",
  "action.image": "Imagen",
  "action.allTabs": "Todas las pestañas",

  "import.bing.empty":
    "No se encontraron colecciones. Si usas una cuenta de empresa o escolar, tus datos no están en Bing Saves; recupéralos desde el CSV o desde collectionsSQLite",
  "import.csv.notice":
    "El CSV solo contiene páginas: las notas y las imágenes no se pueden recuperar de él",
  "import.preview": "Se importarán {n} colecciones y {m} elementos",
  "import.skipped": "Se omitirán {n} elementos duplicados o no válidos",
  "import.confirm": "Importar",
  "import.chooseFile": "Elegir archivo…",
  "import.bing.progress": "Importando {name} ({current}/{total})",
  "import.bing.login":
    "Inicia sesión en Bing con tu cuenta personal y vuelve a intentarlo",
  "import.bing.timeout":
    "La importación de Bing Saves tardó demasiado. Vuelve a intentarlo.",
  "import.bing.parseError":
    "No se pudo leer Bing Saves: {detail}. Es posible que su interfaz haya cambiado.",
  "import.retry": "Reintentar",
  "section.delete": "Eliminar sección",
  "section.deleteConfirm":
    "¿Eliminar la sección «{name}»? Los elementos quedarán sin sección.",
  "import.sqlite.title": "Importar base de datos de Edge",
  "import.sqlite.summary": "Notas recuperadas: {notes} · Imágenes recuperadas: {images}",
  "import.sqlite.empty": "No se encontraron colecciones en la base de datos de Edge",
  "import.sqlite.invalid": "El archivo no es una base de datos SQLite válida",
  "import.sqlite.corrupt": "La base de datos de Edge está dañada o no es compatible",
  "import.sqlite.error": "No se pudo leer la base de datos de Edge",
  "import.json.invalid": "El backup JSON no es válido o su versión no es compatible",
  "import.done": "Importación completada",

  "export.done": "Archivo descargado",
  "export.copy.done": "Enlaces copiados al portapapeles",

  "collection.new": "Nueva colección",
  "collection.rename": "Renombrar",
  "collection.delete": "Eliminar colección",
  "collection.name": "Nombre de la colección",
  "collection.empty": "Todavía no hay colecciones. Crea una para empezar.",
  "items.empty": "Esta colección está vacía.",
  "section.new": "Nueva sección",
  "section.title": "Título de la sección",

  "note.title": "Nueva nota",
  "note.text": "Texto de la nota",
  "image.title": "Añadir imagen",
  "image.url": "URL de la imagen",

  "sort.mode": "Ordenar por",
  "sort.mode.name": "Nombre",
  "sort.mode.createdAt": "Fecha de creación",
  "sort.mode.updatedAt": "Uso reciente",
  "sort.mode.items": "Número de elementos",
  "sort.direction": "Dirección",
  "sort.direction.asc": "Ascendente",
  "sort.direction.desc": "Descendente",

  "settings.title": "Ajustes",
  "settings.theme": "Tema",
  "settings.theme.light": "Claro",
  "settings.theme.dark": "Oscuro",
  "settings.theme.system": "Sistema",
  "settings.defaultCollection": "Colección por defecto",
  "settings.sync": "Sincronización por archivo",
  "settings.sync.enable": "Activar y elegir archivo…",
  "settings.sync.disable": "Desactivar",
  "settings.sync.hint":
    "El archivo se elige desde el panel; el documento offscreen mantiene la sincronización con el panel cerrado.",
  "settings.restore": "Restaurar copia de seguridad JSON…",
  "settings.saved": "Ajustes guardados",

  "sync.conflict.title": "Conflicto de sincronización",
  "sync.conflict.message":
    "El archivo remoto tiene cambios distintos con la misma marca de tiempo. No se ha sobrescrito nada: revisa la copia del archivo remoto y confirma antes de reemplazarlo con tu estado local.",
  "sync.conflict.remote": "Copia del archivo remoto",
  "sync.conflict.overwrite": "Sobrescribir archivo remoto",
  "sync.conflict.deferred": "Conflicto pendiente: el archivo remoto no se ha tocado",
  "sync.conflict.resolved": "Conflicto resuelto: archivo remoto actualizado",
  "sync.backup.title": "Copia del archivo remoto",
  "sync.backup.view": "Ver copia del archivo remoto",
  "sync.backup.empty": "Todavía no hay una copia del archivo remoto.",
  "move.targets": "Mover a…",

  "card.open": "Abrir",
  "card.copy": "Copiar enlace",
  "card.edit": "Editar",
  "card.delete": "Eliminar",
  "card.drag": "Arrastra para reordenar",

  "drag.dock": "Suelta aquí para guardar en Colecciones",
  "toast.saved": "Guardado",
  "common.save": "Guardar",
  "common.cancel": "Cancelar",
  "common.close": "Cerrar",
  "common.delete": "Eliminar",
  "common.error": "No se pudo completar la operación",
};

/**
 * Devuelve una cadena en español. `params` sustituye marcadores `{nombre}`.
 * Una clave desconocida se devuelve tal cual para hacer evidente la ausencia.
 */
export function t(key, params) {
  const clave = String(key);
  if (!Object.hasOwn(CADENAS, clave)) return clave;
  const cadena = CADENAS[clave];
  if (!params || typeof params !== "object") return cadena;
  return cadena.replace(/\{([a-zA-Z0-9_]+)\}/g, (todo, nombre) =>
    Object.hasOwn(params, nombre) ? String(params[nombre]) : todo
  );
}
