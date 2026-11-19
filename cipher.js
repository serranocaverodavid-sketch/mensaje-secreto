/*
 * Motor del cifrado "El juego del mensaje secreto".
 * Cada carácter se sustituye por un número romano. Los códigos de una palabra se unen con "-"
 * y las palabras se separan con "--" (un doble guion es un espacio).
 * Al descifrar también se aceptan los espacios normales (formato del documento original).
 *
 * Dos tablas:
 *  - "original": la del documento, completada con S, u y w (códigos libres XXXIX, XLIII y XLVII).
 *  - "mejorada": completa y sin códigos repetidos (A=I, a=II, B=III ... en orden).
 */
(function (root) {
  'use strict';

  function toRoman(n) {
    const map = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
    return s;
  }

  // ---- Tabla ORIGINAL: la del diccionario `codificacion` del documento ----
  const ORIGINAL_PAIRS = [
    ['A', 'I'], ['a', 'II'], ['B', 'III'], ['b', 'IV'], ['C', 'V'], ['c', 'VI'],
    ['D', 'VII'], ['d', 'VIII'], ['E', 'IX'], ['e', 'X'], ['F', 'XI'], ['f', 'XII'],
    ['G', 'XIII'], ['g', 'XIV'], ['H', 'XV'], ['h', 'XVI'], ['I', 'XVII'], ['i', 'XVIII'],
    ['J', 'XIX'], ['j', 'XX'], ['K', 'XXI'], ['k', 'XXII'], ['L', 'XXIII'], ['l', 'XXIV'],
    ['M', 'XXV'], ['m', 'XXVI'], ['N', 'XXVII'], ['n', 'XXVIII'], ['Ñ', 'XXIX'], ['ñ', 'XXX'],
    ['O', 'XXXI'], ['o', 'XXXII'], ['P', 'XXXIII'], ['p', 'XXXIV'], ['Q', 'XXXV'], ['q', 'XXXVI'],
    ['R', 'XXXVII'], ['r', 'XXXVIII'],
    ['S', 'XXXIX'],                                   // añadida: hueco libre del documento
    ['s', 'XL'], ['T', 'XLI'], ['t', 'XLII'],
    ['u', 'XLIII'],                                   // añadida: hueco libre del documento
    ['U', 'XLIV'], ['V', 'XLV'], ['v', 'XLVI'],
    ['w', 'XLVII'],                                   // añadida: hueco libre del documento
    ['W', 'XLVIII'], ['X', 'XLIX'], ['x', 'L'],
    ['Y', 'LI'], ['y', 'LI'], ['Z', 'LII'], ['z', 'LIV'],
    ['Á', 'LV'], ['á', 'LVI'], ['É', 'LVII'], ['é', 'LVIII'], ['Í', 'LIX'], ['í', 'LX'],
    ['Ó', 'LXI'], ['ó', 'LXII'], ['Ú', 'LXIII'], ['ú', 'LXIV'], ['Ü', 'LXV'], ['ü', 'LXVI'],
    ['0', 'LXXVII'], ['1', 'LXXVIII'], ['2', 'LXIX'], ['3', 'LXX'], ['4', 'LXXI'],
    ['5', 'LXXI'], ['6', 'LXXII'], ['7', 'LXXIII'], ['8', 'LXXIV'], ['9', 'LXXV'],
    [';', 'LXXXVI'], ['_', 'LXXXVIII'], ['(', 'LXXXVIII'], [')', 'XCI'],
    ['[', 'XCIII'], ['{', 'XCVI'],
    ['@', 'LXXVI'], ['#', 'LXXVII'], ['$', 'LXXVIII'], ['%', 'LXXIX'], ['&', 'XCXX'],
    ['*', 'XCVII'], ['?', 'XCVIII'], ['+', 'XCIX'], ['<', 'C'], ['>', 'CI'],
    ['^', 'CII'], ['`', 'CIII'], ['|', 'CV'], ['"', 'CVI'], ["'", 'CVII'],
    // Extra: el guion no estaba en la tabla y rompería el separador. CIV era un hueco libre.
    ['-', 'CIV']
  ];

  // ---- Tabla MEJORADA: secuencia continua 1..110, sin huecos ni repetidos ----
  const LETTERS = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnÑñOoPpQqRrSsTtUuVvWwXxYyZz';
  const ACCENTS = 'ÁáÉéÍíÓóÚúÜü';
  const DIGITS = '0123456789';
  const SYMBOLS = '@#$%&*?+<>^`|"\';_()[]{}-=/\\~.,:!¡¿';
  const IMPROVED_PAIRS = [...(LETTERS + ACCENTS + DIGITS + SYMBOLS)].map((ch, i) => [ch, toRoman(i + 1)]);

  function makeTable(id, label, pairs) {
    const enc = new Map(pairs);
    const dec = new Map();
    const amb = new Set(); // códigos compartidos por más de un carácter
    // Igual que el bucle del documento: si hay repetidos, gana el último.
    for (const [ch, code] of pairs) {
      if (dec.has(code)) amb.add(code);
      dec.set(code, ch);
    }
    return { id, label, pairs, enc, dec, amb };
  }

  const TABLES = {
    original: makeTable('original', 'Tabla original', ORIGINAL_PAIRS),
    mejorada: makeTable('mejorada', 'Tabla mejorada', IMPROVED_PAIRS)
  };

  // Caracteres alfanuméricos que la tabla original no codifica (ahora ninguno)
  const MISSING_IN_ORIGINAL = [...(LETTERS + ACCENTS + DIGITS)].filter(ch => !TABLES.original.enc.has(ch));

  function groupOf(ch) {
    if (LETTERS.includes(ch)) return 'Letras';
    if (ACCENTS.includes(ch)) return 'Acentos';
    if (DIGITS.includes(ch)) return 'Números';
    return 'Símbolos';
  }

  const WS_OR_WORD = /(\s+)|(\S+)/g;
  const TOKENS = /(\s+)|(-+)|([^\s-]+)/g;

  /**
   * Texto normal -> código. Devuelve { out, toks } (toks sirve para dibujar la traza).
   * Cada espacio se escribe como "--"; los saltos de línea y tabulaciones se conservan.
   */
  function encode(text, tbl) {
    const toks = [];
    let out = '';
    text = text.normalize('NFC');
    WS_OR_WORD.lastIndex = 0;
    let m;
    while ((m = WS_OR_WORD.exec(text))) {
      if (m[1]) {
        for (const ch of m[1]) {
          if (ch === ' ') { out += '--'; toks.push({ ws: true, space: true }); }
          else { out += ch; toks.push({ ws: true }); }
        }
        continue;
      }
      [...m[2]].forEach((ch, i) => {
        const code = tbl.enc.get(ch);
        const flag = code === undefined ? 'none' : (tbl.dec.get(code) !== ch ? 'dup' : '');
        const o = code === undefined ? ch : code;
        out += (i ? '-' : '') + o;
        toks.push({ src: ch, out: o, flag, back: code === undefined ? ch : tbl.dec.get(code) });
      });
    }
    return { out, toks };
  }

  /**
   * Código -> texto normal. "--" es un espacio (dos guiones seguidos = un espacio).
   * También acepta espacios normales ("II II") y el formato del código Python ("II- -XLII").
   */
  function decode(code, tbl) {
    const toks = [];
    let out = '';
    const text = code.normalize('NFC').replace(/-(\s+)-/g, '$1');
    TOKENS.lastIndex = 0;
    let m;
    while ((m = TOKENS.exec(text))) {
      if (m[1]) { out += m[1]; toks.push({ ws: true }); continue; }
      if (m[2]) {
        // una racha de n guiones: 1 = separador; cada pareja "--" = un espacio
        for (let k = 0; k < Math.floor(m[2].length / 2); k++) { out += ' '; toks.push({ ws: true, space: true }); }
        continue;
      }
      const t = m[3];
      const ch = tbl.dec.get(t.toUpperCase());
      const flag = ch === undefined ? 'none' : (tbl.amb.has(t.toUpperCase()) ? 'dup' : '');
      out += ch === undefined ? t : ch;
      toks.push({ src: t, out: ch === undefined ? t : ch, flag });
    }
    return { out, toks };
  }

  /** ¿Parece código romano con guiones? (para sugerir cambiar de dirección) */
  function looksLikeCode(text) {
    const t = text.trim();
    if (!t) return false;
    return t.replace(/[IVXLC\s-]/gi, '').length / t.length < 0.3;
  }

  // El mensaje del documento, con "--" como espacio
  const SECRET = 'XV-XXXII-XXIV-II--II--XLII-XXXII-VII-XXXII-XL--XXIV-XXXII-XL--VI-XXXII-XXVI-XXXIV-XVIII-XL--VII-X--XXIV-II--VI-XXIV-II-XL-X--XL-XXXII-XXVI-XXXII-XL--X-XXIV--XXVI-X-XX-XXXII-XXXVIII--XIV-XXXVIII-XLIV-XXXIV-XXXII';

  root.Cipher = { TABLES, encode, decode, looksLikeCode, groupOf, toRoman, MISSING_IN_ORIGINAL, SECRET };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Cipher;
})(typeof window !== 'undefined' ? window : globalThis);
