// Разбор и сохранение ZMK .keymap: слои, их названия и привязки клавиш.

// Комментарии заменяем пробелами той же длины — смещения в тексте сохраняются
const mask = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));

function findKeymapBlock(text) {
  const m = /compatible\s*=\s*"zmk,keymap"/.exec(text);
  if (!m) throw new Error('В файле нет узла keymap (compatible = "zmk,keymap")');
  const open = text.lastIndexOf('{', m.index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { start: open, end: i };
    }
  }
  throw new Error('Не найден конец узла keymap');
}

export function tokenize(bindings) {
  return bindings
    .split('&')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((s) => '&' + s);
}

/** → { text, layers: [{ node, name, bindings, bStart, bEnd, nStart, nEnd }] } */
export function parseKeymap(text) {
  const masked = mask(text);
  const blk = findKeymapBlock(masked);
  const base = blk.start + 1;
  const inner = masked.slice(base, blk.end);
  const re = /([A-Za-z_][\w-]*)\s*\{([^{}]*)\}/g;
  const layers = [];
  let m;
  while ((m = re.exec(inner))) {
    const body = m[2];
    const bodyStart = base + m.index + m[0].indexOf('{') + 1;
    const b = /bindings\s*=\s*<([^>]*)>\s*;/.exec(body);
    if (!b) continue;
    const bStart = bodyStart + b.index + b[0].indexOf('<') + 1;
    const layer = { node: m[1], name: m[1], bindings: tokenize(b[1]), bStart, bEnd: bStart + b[1].length, nStart: -1, nEnd: -1 };
    const n = /display-name\s*=\s*"([^"]*)"/.exec(body);
    if (n) {
      layer.name = n[1];
      layer.nStart = bodyStart + n.index + n[0].indexOf('"') + 1;
      layer.nEnd = layer.nStart + n[1].length;
    }
    layers.push(layer);
  }
  if (!layers.length) throw new Error('Слои не найдены');
  return { text, layers };
}

function formatBindings(list) {
  const rows = list.length === 42 ? [12, 12, 12, 6] : list.length === 36 ? [10, 10, 10, 6] : null;
  const chunks = [];
  if (rows) {
    let i = 0;
    for (const n of rows) { chunks.push(list.slice(i, i + n)); i += n; }
  } else {
    for (let i = 0; i < list.length; i += 12) chunks.push(list.slice(i, i + 12));
  }
  const width = Math.max(...list.map((s) => s.length));
  const lines = chunks.map((row, r) => {
    const pad = rows && r === 3 ? ' '.repeat((width + 1) * 3) : '';
    return '   ' + pad + row.map((s) => s.padEnd(width)).join(' ').trimEnd();
  });
  return '\n' + lines.join('\n') + '\n            ';
}

/** Собирает текст файла с изменёнными привязками и названиями слоёв. */
export function serializeKeymap(model) {
  const edits = [];
  for (const l of model.layers) {
    edits.push({ s: l.bStart, e: l.bEnd, t: formatBindings(l.bindings) });
    if (l.nStart >= 0) edits.push({ s: l.nStart, e: l.nEnd, t: l.name.replace(/"/g, '') });
  }
  edits.sort((a, b) => b.s - a.s);
  let text = model.text;
  for (const ed of edits) text = text.slice(0, ed.s) + ed.t + text.slice(ed.e);
  return text;
}

const KEY_LABELS = {
  SPACE: '␣', SPC: '␣', RET: '⏎', ENTER: '⏎', RETURN: '⏎', BSPC: '⌫', BACKSPACE: '⌫', DEL: 'Del', DELETE: 'Del',
  TAB: 'Tab', ESC: 'Esc', ESCAPE: 'Esc', LSHFT: '⇧', RSHFT: '⇧', LSHIFT: '⇧', RSHIFT: '⇧',
  LCTRL: 'Ctrl', RCTRL: 'Ctrl', LALT: 'Alt', RALT: 'AltGr', LGUI: 'Win', RGUI: 'Win',
  LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓', HOME: 'Home', END: 'End', PG_UP: 'PgUp', PG_DN: 'PgDn',
  SEMI: ';', SEMICOLON: ';', SQT: "'", APOS: "'", COMMA: ',', DOT: '.', FSLH: '/', SLASH: '/', BSLH: '\\',
  MINUS: '-', EQUAL: '=', LBKT: '[', RBKT: ']', LBRC: '{', RBRC: '}', GRAVE: '`', TILDE: '~',
  EXCL: '!', AT: '@', HASH: '#', DOLLAR: '$', PRCNT: '%', CARET: '^', AMPS: '&', ASTRK: '*', STAR: '*',
  LPAR: '(', RPAR: ')', UNDER: '_', PLUS: '+', PIPE: '|', COLON: ':', DQT: '"', LT: '<', GT: '>', QMARK: '?',
  CAPS: 'Caps', CAPSLOCK: 'Caps', PSCRN: 'PrtSc', C_VOL_UP: 'Vol+', C_VOL_DN: 'Vol−', C_MUTE: 'Mute',
  C_PP: '⏯', C_NEXT: '⏭', C_PREV: '⏮',
};

export function keyLabel(binding, layers = []) {
  const parts = binding.slice(1).split(' ');
  const [b, a1, a2] = parts;
  const layerName = (n) => (layers[+n] ? layers[+n].name : n);
  switch (b) {
    case 'kp': {
      let k = parts.slice(1).join(' ');
      const MODS = { LC: 'Ctrl', RC: 'Ctrl', LS: '⇧', RS: '⇧', LA: 'Alt', RA: 'AltGr', LG: 'Win', RG: 'Win' };
      const mods = [];
      let m;
      while ((m = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.*)\)$/.exec(k))) { mods.push(MODS[m[1]]); k = m[2]; }
      const lbl = KEY_LABELS[k] || (/^N\d$/.test(k) ? k.slice(1) : /^NUMBER_\d$/.test(k) ? k.slice(-1) : k);
      return mods.length ? `${mods.join('+')}+${lbl}` : lbl;
    }
    case 'trans': return '▽';
    case 'none': return '✕';
    case 'mo': return `↑${layerName(a1)}`;
    case 'tog': return `⇄${layerName(a1)}`;
    case 'to': return `→${layerName(a1)}`;
    case 'lt': return `${KEY_LABELS[a2] || a2}/${layerName(a1)}`;
    case 'mt': return `${KEY_LABELS[a2] || a2}/${KEY_LABELS[a1] || a1}`;
    case 'bt':
      if (a1 === 'BT_SEL') return `BT${+a2 + 1}`;
      if (a1 === 'BT_CLR') return 'BT clr';
      return a1.replace('BT_', 'BT ');
    case 'rgb_ug': return { RGB_TOG: 'RGB⏻', RGB_EFF: 'RGB»', RGB_EFR: 'RGB«', RGB_BRI: '☀+', RGB_BRD: '☀−', RGB_HUI: 'Hue+', RGB_HUD: 'Hue−', RGB_SAI: 'Sat+', RGB_SAD: 'Sat−', RGB_SPI: 'Spd+', RGB_SPD: 'Spd−', RGB_ON: 'RGB on', RGB_OFF: 'RGB off' }[a1] || 'RGB';
    case 'bootloader': return 'BOOT';
    case 'sys_reset': return 'Reset';
    case 'studio_unlock': return 'Studio';
    case 'out': return a1 === 'OUT_USB' ? 'USB' : a1 === 'OUT_BLE' ? 'BLE' : 'Out';
    case 'ext_power': return 'Pwr';
    default: return b;
  }
}
