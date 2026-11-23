// lib/sqlite.js
// Lector SQLite mínimo, de solo lectura, para collectionsSQLite de Edge.
// Entiende la cabecera, árboles B de tabla (hoja e interior), celdas con
// desbordamiento y registros con varints/serial types. Sin dependencias,
// sin globals de navegador: se importa igual en Node que en la extensión.

const MAGIC = "SQLite format 3\0";
const CODIFICADOR = new TextEncoder();
const DECODIFICADOR = new TextDecoder("utf-8");
const TIPOS_CANONICOS = new Set(["page", "link", "image", "text", "note"]);
const TABLAS_REQUERIDAS = ["collections", "items", "collections_items_relationship"];
const CLAVE_STATS = {
  page: "pages",
  link: "links",
  image: "images",
  text: "texts",
  note: "notes",
};

function aBytes(entrada) {
  if (entrada instanceof Uint8Array) return entrada;
  if (entrada instanceof ArrayBuffer) return new Uint8Array(entrada);
  if (entrada && typeof entrada.length === "number") return Uint8Array.from(entrada);
  return new Uint8Array();
}

function tieneCabecera(bytes) {
  if (bytes.length < 16) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

// Todas las magnitudes de SQLite (incluida la cabecera) son big-endian.
function u16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>> 0
  );
}

function concatenar(partes) {
  let total = 0;
  for (const parte of partes) total += parte.length;
  const salida = new Uint8Array(total);
  let cursor = 0;
  for (const parte of partes) {
    salida.set(parte, cursor);
    cursor += parte.length;
  }
  return salida;
}

function leerVarint(bytes, offset) {
  let valor = 0;
  for (let i = 0; i < 9; i++) {
    const byte = bytes[offset++];
    if (byte === undefined) throw new Error("SQLITE_CORRUPT");
    if (i === 8) {
      valor = valor * 128 + byte;
      break;
    }
    valor = valor * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return { valor, siguiente: offset };
}

function requiereBytes(bytes, offset, longitud) {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(longitud) ||
    offset < 0 ||
    longitud < 0 ||
    offset + longitud > bytes.length
  ) {
    throw new Error("SQLITE_CORRUPT");
  }
}

function leerEntero(bytes, offset, tamano) {
  requiereBytes(bytes, offset, tamano);
  let valor = 0;
  for (let i = 0; i < tamano; i++) valor = valor * 256 + bytes[offset + i];
  const mitad = 2 ** (8 * tamano - 1);
  return valor >= mitad ? valor - 2 ** (8 * tamano) : valor;
}

function texto(valor) {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Uint8Array) return DECODIFICADOR.decode(valor);
  return typeof valor === "string" ? valor : String(valor);
}

function limpio(valor) {
  return texto(valor)
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
}

function bytesDe(valor) {
  if (valor instanceof Uint8Array) return valor;
  if (typeof valor === "string") return CODIFICADOR.encode(valor);
  return null;
}

function esBorrado(fila) {
  const valor = fila.is_marked_for_deletion;
  if (valor === true) return true;
  if (typeof valor === "number") return valor !== 0;
  return limpio(valor).toLowerCase() === "true";
}

function posicionDe(valor, defecto = Infinity) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : defecto;
}

// Los identificadores de columna pueden venir entre comillas dobles,
// corchetes o acentos graves en el CREATE TABLE de sqlite_master.
function identificador(definicion) {
  const trozo = definicion.trim();
  if (!trozo) return "";
  if (trozo[0] === '"' || trozo[0] === "`") {
    const fin = trozo.indexOf(trozo[0], 1);
    return (fin < 0 ? trozo.slice(1) : trozo.slice(1, fin)).toLowerCase();
  }
  if (trozo[0] === "[") {
    const fin = trozo.indexOf("]");
    return (fin < 0 ? trozo.slice(1) : trozo.slice(1, fin)).toLowerCase();
  }
  return trozo.split(/\s+/)[0].toLowerCase();
}

// Extrae los nombres de columna del DDL sin ejecutarlo: basta con recorrer el
// primer paréntesis y respetar citas y paréntesis anidados.
function columnasDeSql(sql) {
  const ddl = texto(sql);
  const inicio = ddl.indexOf("(");
  if (inicio < 0) return [];
  const partes = [];
  let actual = "";
  let profundidad = 0;
  let cita = null;

  for (let i = inicio + 1; i < ddl.length; i++) {
    const caracter = ddl[i];
    if (cita) {
      actual += caracter;
      if (caracter === cita) {
        if (ddl[i + 1] === cita) actual += ddl[++i];
        else cita = null;
      }
      continue;
    }
    if (caracter === '"' || caracter === "'" || caracter === "`") {
      cita = caracter;
      actual += caracter;
    } else if (caracter === "[") {
      cita = "]";
      actual += caracter;
    } else if (caracter === "(") {
      profundidad++;
      actual += caracter;
    } else if (caracter === ")") {
      if (profundidad === 0) {
        partes.push(actual);
        break;
      }
      profundidad--;
      actual += caracter;
    } else if (caracter === "," && profundidad === 0) {
      partes.push(actual);
      actual = "";
    } else {
      actual += caracter;
    }
  }

  return partes.map(identificador).filter(Boolean);
}

class LectorSqlite {
  constructor(bytes) {
    const tamanoPaginaOriginal = u16(bytes, 16);
    const tamanoPagina = tamanoPaginaOriginal === 1 ? 65536 : tamanoPaginaOriginal;
    const potenciaDos = tamanoPagina >= 512 && tamanoPagina <= 65536 &&
      (tamanoPagina & (tamanoPagina - 1)) === 0;
    const reservados = bytes[20];
    if (!potenciaDos || reservados >= tamanoPagina || bytes.length < tamanoPagina) {
      throw new Error("SQLITE_UNSUPPORTED");
    }

    this.bytes = bytes;
    this.tamanoPagina = tamanoPagina;
    this.utiles = tamanoPagina - reservados;
    this.encoding = u32(bytes, 56) || 1;
    this.paginasDisponibles = Math.floor(bytes.length / tamanoPagina);
    this.paginas = new Map();
    this.esquemaCache = null;
  }

  inicioPagina(numero) {
    if (!Number.isInteger(numero) || numero < 1 || numero > this.paginasDisponibles) {
      throw new Error("SQLITE_CORRUPT");
    }
    return (numero - 1) * this.tamanoPagina;
  }

  pagina(numero) {
    if (!this.paginas.has(numero)) {
      const inicio = this.inicioPagina(numero);
      this.paginas.set(numero, this.bytes.subarray(inicio, inicio + this.tamanoPagina));
    }
    return this.paginas.get(numero);
  }

  decodificar(bytes) {
    if (this.encoding === 2) {
      try {
        return new TextDecoder("utf-16le").decode(bytes);
      } catch {
        // Algunos entornos antiguos no traen TextDecoder: se degrada a UTF-8.
      }
    }
    if (this.encoding === 3) {
      let salida = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        salida += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      }
      return salida;
    }
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      let salida = "";
      for (const byte of bytes) salida += String.fromCharCode(byte);
      return salida;
    }
  }

  longitudLocal(longitud) {
    const maxLocal = this.utiles - 35;
    if (longitud <= maxLocal) return longitud;
    const minLocal = Math.floor(((this.utiles - 12) * 32) / 255) - 23;
    const excedente = minLocal + ((longitud - minLocal) % (this.utiles - 4));
    return excedente <= maxLocal ? excedente : minLocal;
  }

  desbordamiento(numeroPagina, restante, vistos) {
    const partes = [];
    let pagina = numeroPagina;
    while (restante > 0 && pagina && !vistos.has(pagina)) {
      vistos.add(pagina);
      const inicio = this.inicioPagina(pagina);
      const siguiente = u32(this.bytes, inicio);
      const utiles = Math.max(1, this.utiles - 4);
      const longitud = Math.min(restante, utiles);
      partes.push(this.bytes.subarray(inicio + 4, inicio + 4 + longitud));
      restante -= longitud;
      pagina = siguiente;
    }
    return partes;
  }

  payloadCelda(numeroPagina, puntero) {
    const inicioPagina = this.inicioPagina(numeroPagina);
    const inicioCelda = inicioPagina + puntero;
    const { valor: longitud, siguiente: trasLongitud } = leerVarint(this.bytes, inicioCelda);
    const { siguiente: trasRowid } = leerVarint(this.bytes, trasLongitud);
    const local = this.longitudLocal(longitud);
    const disponible = Math.max(0, inicioPagina + this.utiles - trasRowid);
    const leido = Math.min(local, disponible, longitud);
    const partes = [this.bytes.subarray(trasRowid, trasRowid + leido)];
    const restante = longitud - leido;
    if (restante > 0) {
      const punteroDesbordamiento = trasRowid + local;
      requiereBytes(this.bytes, punteroDesbordamiento, 4);
      const siguientePagina = u32(this.bytes, punteroDesbordamiento);
      partes.push(...this.desbordamiento(siguientePagina, restante, new Set([numeroPagina])));
    }
    return concatenar(partes);
  }

  registro(payload) {
    const { valor: longitudCabecera, siguiente } = leerVarint(payload, 0);
    if (longitudCabecera < siguiente || longitudCabecera > payload.length) {
      throw new Error("SQLITE_CORRUPT");
    }
    const tipos = [];
    let cursor = siguiente;
    while (cursor < longitudCabecera) {
      const leido = leerVarint(payload, cursor);
      if (leido.siguiente > longitudCabecera) throw new Error("SQLITE_CORRUPT");
      tipos.push(leido.valor);
      cursor = leido.siguiente;
    }

    const fila = [];
    let dato = longitudCabecera;
    for (const tipo of tipos) {
      if (tipo === 0 || tipo === 10 || tipo === 11) {
        fila.push(null);
        continue;
      }
      if (tipo === 8 || tipo === 9) {
        fila.push(tipo - 8);
        continue;
      }

      let longitud;
      if (tipo >= 1 && tipo <= 6) longitud = tipo;
      else if (tipo === 7) longitud = 8;
      else if (tipo >= 12) longitud = Math.floor((tipo - (tipo % 2 === 0 ? 12 : 13)) / 2);
      else throw new Error("SQLITE_CORRUPT");
      requiereBytes(payload, dato, longitud);

      if (tipo >= 1 && tipo <= 6) {
        fila.push(leerEntero(payload, dato, longitud));
      } else if (tipo === 7) {
        fila.push(new DataView(payload.buffer, payload.byteOffset + dato, 8).getFloat64(0));
      } else {
        const trozo = payload.subarray(dato, dato + longitud);
        fila.push(tipo % 2 === 0 ? trozo.slice() : this.decodificar(trozo));
      }
      dato += longitud;
    }
    return fila;
  }

  filasDeArbol(rootPage, visitados = new Set()) {
    const filas = [];
    const visitar = (numeroPagina) => {
      if (visitados.has(numeroPagina)) return;
      visitados.add(numeroPagina);
      const pagina = this.pagina(numeroPagina);
      const cabecera = numeroPagina === 1 ? 100 : 0;
      const tipo = pagina[cabecera];
      const cantidad = u16(pagina, cabecera + 3);
      const inicioPunteros = cabecera + (tipo === 0x05 ? 12 : 8);

      if (tipo === 0x05) {
        // Árbol interior de tabla: hijos en orden y puntero más a la derecha.
        for (let i = 0; i < cantidad; i++) {
          const hijo = u32(pagina, inicioPunteros + 2 * i);
          visitar(hijo);
        }
        visitar(u32(pagina, cabecera + 8));
        return;
      }
      if (tipo !== 0x0d) throw new Error("SQLITE_UNSUPPORTED");

      for (let i = 0; i < cantidad; i++) {
        const puntero = u16(pagina, inicioPunteros + 2 * i);
        filas.push(this.registro(this.payloadCelda(numeroPagina, puntero)));
      }
    };
    visitar(rootPage);
    return filas;
  }

  esquema() {
    if (this.esquemaCache) return this.esquemaCache;
    const tablas = new Map();
    for (const fila of this.filasDeArbol(1)) {
      if (texto(fila[0]).toLowerCase() !== "table") continue;
      const nombre = limpio(fila[1]);
      const rootPage = posicionDe(fila[3], 0);
      if (!nombre || rootPage < 1) continue;
      tablas.set(nombre.toLowerCase(), {
        rootPage,
        columnas: columnasDeSql(fila[4]),
      });
    }
    this.esquemaCache = tablas;
    return tablas;
  }

  tieneTabla(nombre) {
    return this.esquema().has(nombre.toLowerCase());
  }

  filas(nombre) {
    const tabla = this.esquema().get(nombre.toLowerCase());
    if (!tabla) return [];
    return this.filasDeArbol(tabla.rootPage).map((valores) => {
      const fila = {};
      tabla.columnas.forEach((columna, indice) => {
        fila[columna] = valores[indice] === undefined ? null : valores[indice];
      });
      return fila;
    });
  }
}

function urlDeSource(source) {
  const cru = limpio(source);
  if (!cru) return "";
  let datos;
  try {
    datos = JSON.parse(cru);
  } catch {
    return "";
  }
  if (!datos || typeof datos !== "object") return "";
  const candidatos = [datos.url, datos.URL, datos.uri, datos.link];
  if (datos.source && typeof datos.source === "object") {
    candidatos.push(datos.source.url, datos.source.URL);
  }
  for (const candidato of candidatos) {
    if (typeof candidato === "string" && candidato.trim()) return candidato.trim();
  }
  return "";
}

function mimeImagen(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // Si no se reconoce la firma se conservan los bytes como PNG: mejor perder
  // el tipo exacto que descartar una imagen que Edge guardó en el registro.
  return "image/png";
}

function base64(bytes) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const partes = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    partes.push(
      alfabeto[a >> 2] +
        alfabeto[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alfabeto[((b & 15) << 2) | (c >> 6)] : "=") +
        (i + 2 < bytes.length ? alfabeto[c & 63] : "=")
    );
  }
  return partes.join("");
}

function miniaturaDe(fila) {
  const salida = {};
  const referencia = limpio(fila.canonical_image_url);
  const dataUrl = /^data:image\//i.test(referencia);
  if (dataUrl) salida.thumbnailData = referencia;
  else if (/^https?:\/\//i.test(referencia)) salida.thumbnailUrl = referencia;

  const datos = bytesDe(fila.canonical_image_data);
  if (datos && datos.length && !salida.thumbnailData) {
    salida.thumbnailData = `data:${mimeImagen(datos)};base64,${base64(datos)}`;
  }
  return salida;
}

function tipoDe(tipoEdge, url, textoItem, miniatura) {
  const bruto = limpio(tipoEdge).toLowerCase();
  if (["annotation", "note", "notes", "comment"].includes(bruto)) return "note";
  if (["image", "photo", "picture"].includes(bruto)) return "image";
  if (["text", "selection"].includes(bruto)) return "text";
  if (["link", "hyperlink"].includes(bruto)) return "link";
  if (["website", "webpage", "page", "url", "site"].includes(bruto)) return "page";
  if (textoItem && !url) return "note";
  if (miniatura.thumbnailData && !url) return "image";
  return "page";
}

function tituloDe(fila, url, textoItem) {
  const declarado = limpio(fila.title);
  if (declarado) return declarado;
  if (textoItem) return textoItem.split("\n")[0].slice(0, 80);
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.slice(0, 80);
    }
  }
  return "Sin título";
}

function itemDe(fila) {
  const url = urlDeSource(fila.source);
  const textoItem = limpio(fila.text_content);
  const miniatura = miniaturaDe(fila);
  if (!url && !textoItem && !Object.keys(miniatura).length) return null;

  const tipo = tipoDe(fila.type, url, textoItem, miniatura);
  const item = {
    type: TIPOS_CANONICOS.has(tipo) ? tipo : "page",
    title: tituloDe(fila, url, textoItem),
    url,
  };
  if (textoItem) item.text = textoItem;
  return Object.assign(item, miniatura);
}

function statsVacias() {
  return {
    collections: 0,
    items: 0,
    pages: 0,
    links: 0,
    images: 0,
    texts: 0,
    notes: 0,
    skipped: 0,
  };
}

/**
 * Lee una copia de collectionsSQLite y devuelve colecciones en el formato que
 * espera el store. Nunca escribe el archivo de entrada.
 *
 * @param {Uint8Array|ArrayBuffer|Array<number>} bytes
 * @returns {{collections:Array<{name:string, items:Array}>, stats:Object}}
 * @throws {Error} NOT_A_SQLITE_DB si falta la cabecera `SQLite format 3\0`.
 * @throws {Error} SQLITE_UNSUPPORTED si el formato de página no es compatible.
 * @throws {Error} SQLITE_CORRUPT si el archivo o un registro está truncado/dañado.
 */
export function readCollectionsSqlite(bytes) {
  const entrada = aBytes(bytes);
  if (!tieneCabecera(entrada)) throw new Error("NOT_A_SQLITE_DB");

  const stats = statsVacias();
  const vacio = { collections: [], stats };
  let lector;
  try {
    lector = new LectorSqlite(entrada);
    if (TABLAS_REQUERIDAS.some((nombre) => !lector.tieneTabla(nombre))) return vacio;

    const filasColecciones = lector.filas("collections");
    const filasItems = lector.filas("items");
    const filasRelacion = lector.filas("collections_items_relationship");

    const porId = new Map();
    const ordenColecciones = [];
    for (const fila of filasColecciones) {
      if (esBorrado(fila)) continue;
      const id = limpio(fila.id);
      if (!id || porId.has(id)) continue;
      const coleccion = {
        id,
        name: limpio(fila.title) || "Sin título",
        position: posicionDe(fila.position),
        index: ordenColecciones.length,
        items: [],
      };
      porId.set(id, coleccion);
      ordenColecciones.push(coleccion);
    }

    const itemsPorId = new Map();
    for (const fila of filasItems) {
      if (esBorrado(fila)) {
        stats.skipped++;
        continue;
      }
      const item = itemDe(fila);
      if (!item) {
        stats.skipped++;
        continue;
      }
      const id = limpio(fila.id);
      if (id && !itemsPorId.has(id)) itemsPorId.set(id, item);
    }

    const relacion = new Map();
    for (const fila of filasRelacion) {
      const padre = limpio(fila.parent_id);
      if (!porId.has(padre)) continue;
      if (!relacion.has(padre)) relacion.set(padre, []);
      relacion.get(padre).push({
        itemId: limpio(fila.item_id),
        position: posicionDe(fila.position),
        index: relacion.get(padre).length,
      });
    }

    const usados = new Set();
    for (const [id, coleccion] of porId) {
      const vistosEnColeccion = new Set();
      const entradas = (relacion.get(id) || []).slice().sort(
        (a, b) => a.position - b.position || a.index - b.index
      );
      for (const entrada of entradas) {
        const item = itemsPorId.get(entrada.itemId);
        if (!item || vistosEnColeccion.has(entrada.itemId)) continue;
        vistosEnColeccion.add(entrada.itemId);
        usados.add(entrada.itemId);
        coleccion.items.push(item);
      }
    }
    for (const id of itemsPorId.keys()) {
      if (!usados.has(id)) stats.skipped++;
    }

    const colecciones = ordenColecciones
      .slice()
      .sort((a, b) => a.position - b.position || a.index - b.index)
      .map(({ name, items }) => ({ name, items }));

    stats.collections = colecciones.length;
    stats.items = colecciones.reduce((suma, col) => suma + col.items.length, 0);
    for (const col of colecciones) {
      for (const item of col.items) {
        const clave = CLAVE_STATS[item.type];
        if (clave) stats[clave]++;
      }
    }
    return { collections: colecciones, stats };
  } catch (error) {
    // Solo "sin tablas de Edge" es un resultado vacío legítimo (se devuelve
    // arriba). Cualquier fallo de página, celda o registro debe llegar al
    // panel como un error discernible, no como una importación vacía.
    if (
      error instanceof Error &&
      (error.message === "SQLITE_CORRUPT" || error.message === "SQLITE_UNSUPPORTED")
    ) {
      throw error;
    }
    throw new Error("SQLITE_CORRUPT");
  }
}
