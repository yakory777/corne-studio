// Движок экрана 128×32: страница из элементов → 1-битная картинка (512 байт) для DISP IMG.
// Текст рисуется шрифтами Windows, поэтому кириллица и любые символы работают.

export const W = 128, H = 32;

const FONTS = {
  sans: '"Segoe UI", Arial, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
  narrow: '"Arial Narrow", "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  impact: 'Impact, "Arial Black", sans-serif',
  round: '"Comic Sans MS", "Segoe Print", cursive',
  script: '"Segoe Script", "Brush Script MT", cursive',
  terminal: '"Lucida Console", Consolas, monospace',
};
export const FONT_NAMES = { sans: 'Обычный', mono: 'Моноширинный', narrow: 'Узкий', serif: 'С засечками', impact: 'Плакатный', round: 'Округлый', script: 'Рукописный', terminal: 'Терминал', custom: 'Свой (имя шрифта Windows)…' };
export const TEXT_EFFECTS = { none: 'нет', blink: 'мигание', type: 'печатная машинка', shake: 'дрожание', wave: 'волна', box: 'в плашке (инверсия)' };
const fontCss = (el) => `${el.bold ? 'bold ' : ''}${el.size}px ${el.font === 'custom' && el.fontName ? `"${el.fontName}", sans-serif` : FONTS[el.font] || FONTS.sans}`;

export const ELEMENT_TYPES = {
  text: { name: 'Текст', defaults: { x: 0, y: 0, size: 12, font: 'sans', bold: false, align: 'left', text: 'Привет, {day}!' } },
  marquee: { name: 'Бегущая строка', defaults: { y: 10, size: 14, font: 'sans', bold: true, speed: 30, text: 'Corne Studio — бегущая строка' } },
  bar: { name: 'Полоса', defaults: { x: 0, y: 26, w: 128, h: 6, value: '{bat}' } },
  icon: { name: 'Иконка', defaults: { x: 0, y: 0, icon: 'battery', scale: 1 } },
  image: { name: 'Картинка', defaults: { x: 0, y: 0, w: 32, h: 32, bits: '' } },
  anim: { name: 'Анимация', defaults: { anim: 'stars', x: 0, y: 0, w: 128, h: 32 } },
  frame: { name: 'Рамка', defaults: { x: 0, y: 0, w: 128, h: 32, radius: 0, fill: false } },
  line: { name: 'Линия', defaults: { x: 0, y: 16, x2: 127, y2: 16, dash: false } },
  graph: { name: 'График', defaults: { x: 0, y: 0, w: 128, h: 32, value: '{cpu}', min: 0, max: 100, style: 'area', step: 1 } },
  gauge: { name: 'Кольцо-индикатор', defaults: { x: 2, y: 2, r: 14, thick: 3, value: '{bat}' } },
  clock: { name: 'Аналоговые часы', defaults: { x: 2, y: 2, r: 14, seconds: true, ticks: true } },
  seg: { name: 'Цифры (7 сегментов)', defaults: { x: 4, y: 3, size: 26, text: '{time}', thick: 3 } },
  dots: { name: 'Индикатор слоя', defaults: { x: 0, y: 28, count: 3, value: '{layernum}', r: 2, gap: 8 } },
  keys: { name: 'Мини-клавиатура', defaults: { x: 0, y: 0, scale: 2 } },
  gif: { name: 'Анимация из GIF', defaults: { x: 0, y: 0, w: 128, h: 32, frames: [] } },
};
export const ICONS = {
  battery: 'Батарея', bt: 'Bluetooth', usb: 'USB', heart: 'Сердце', star: 'Звезда', clock: 'Часы', bolt: 'Молния', claude: 'Claude',
  wifi: 'Wi-Fi', music: 'Музыка', mail: 'Письмо', cpu: 'Процессор', sun: 'Солнце', cloud: 'Облако', rain: 'Дождь', snow: 'Снежинка',
  lock: 'Замок', check: 'Галочка', cross: 'Крестик', smile: 'Смайлик', cat: 'Кот', coffee: 'Кофе', fire: 'Огонь', warn: 'Внимание',
  home: 'Дом', gear: 'Шестерёнка', up: 'Вверх', down: 'Вниз', key: 'Клавиша', moon: 'Луна',
};
// Пиксельные иконки 8×8: # — горит
const GLYPHS = {
  wifi: ['..####..', '.#....#.', '#..##..#', '..#..#..', '........', '...##...', '...##...', '........'],
  music: ['...####.', '...#..#.', '...#..#.', '...#..#.', '.###.###', '####.###', '.##..##.', '........'],
  mail: ['########', '##....##', '#.#..#.#', '#..##..#', '#......#', '#......#', '########', '........'],
  cpu: ['.#.#.#..', '#######.', '.#...#..', '##.#.##.', '.#...#..', '#######.', '.#.#.#..', '........'],
  sun: ['#..#..#.', '.#...#..', '...#....', '#.###.#.', '...#....', '.#...#..', '#..#..#.', '........'],
  cloud: ['........', '...##...', '..#..#..', '.#....##', '#.......', '#.......', '.#######', '........'],
  rain: ['...##...', '..#..##.', '.#.....#', '.#######', '........', '.#..#..#', '#..#..#.', '........'],
  snow: ['...#....', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '...#....', '........'],
  lock: ['..###...', '.#...#..', '.#...#..', '#######.', '#######.', '###.###.', '#######.', '........'],
  check: ['.......#', '......##', '#....##.', '##..##..', '.####...', '..##....', '........', '........'],
  cross: ['#.....#.', '.#...#..', '..#.#...', '...#....', '..#.#...', '.#...#..', '#.....#.', '........'],
  smile: ['.#####..', '#.....#.', '#.#.#.#.', '#.....#.', '#.#.#.#.', '#..#..#.', '.#####..', '........'],
  cat: ['#.....#.', '##...##.', '#######.', '#.#.#.#.', '#######.', '#..#..#.', '.#####..', '........'],
  coffee: ['.#.#....', '#.#.....', '......#.', '#####.#.', '#####.#.', '######..', '.###....', '........'],
  fire: ['...#....', '...##...', '..###...', '.##.##..', '.#...#..', '##...##.', '.#####..', '........'],
  warn: ['...#....', '..#.#...', '..#.#...', '.#.#.#..', '.#...#..', '#..#..#.', '#######.', '........'],
  home: ['...#....', '..###...', '.#####..', '#######.', '.#...#..', '.#.#.#..', '.#.#.#..', '........'],
  gear: ['.#.#.#..', '#######.', '.##.##..', '##...##.', '.##.##..', '#######.', '.#.#.#..', '........'],
  up: ['...#....', '..###...', '.#####..', '#######.', '..###...', '..###...', '..###...', '........'],
  down: ['..###...', '..###...', '..###...', '#######.', '.#####..', '..###...', '...#....', '........'],
  key: ['#######.', '#.....#.', '#.###.#.', '#.....#.', '#######.', '.#####..', '........', '........'],
  moon: ['..###...', '.##.....', '##......', '##......', '##......', '.##...#.', '..####..', '........'],
};
export const ANIMS = { stars: 'Звёзды', matrix: 'Матрица', snow: 'Снег', eq: 'Эквалайзер (звук ПК)', wave: 'Волна', bounce: 'Прыгающий мяч', life: 'Игра «Жизнь»', typing: 'Пульс печати' };

export const VARS = {
  '{time}': 'время 12:34', '{sec}': 'время 12:34:56', '{date}': 'дата 8 нояб.', '{day}': 'день недели', '{bat}': 'заряд %',
  '{layer}': 'слой', '{bt}': 'профиль BT', '{wpm}': 'слов/мин', '{presses}': 'нажатий сегодня', '{cpu}': 'CPU %', '{ram}': 'RAM %',
  '{weather}': 'погода', '{temp}': 'температура', '{claude}': 'статус Claude', '{pomodoro}': 'Pomodoro', '{pet}': 'питомец', '{profile}': 'профиль',
  '{layernum}': 'номер слоя', '{app}': 'активная программа', '{hour}': 'часы', '{min}': 'минуты', '{year}': 'год', '{month}': 'месяц',
  '{uptime}': 'ПК работает', '{days:2026-12-31}': 'дней до даты',
};

export function fillVars(text, v) {
  return String(text || '')
    .replace(/\{days:(\d{4}-\d\d-\d\d)\}/g, (m, d) => String(Math.max(0, Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000))))
    .replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : m));
}

/** Условие показа элемента: «{bat} < 20», «{layer} == NUMBER», пусто — всегда */
export function checkCond(cond, v) {
  if (!cond || !cond.trim()) return true;
  const m = /^(.*?)\s*(<=|>=|==|!=|<|>)\s*(.*)$/.exec(fillVars(cond, v).trim());
  if (!m) return true;
  const [, a, op, b] = m;
  const na = parseFloat(a), nb = parseFloat(b);
  const num = !isNaN(na) && !isNaN(nb);
  const A = num ? na : a.trim(), B = num ? nb : b.trim();
  switch (op) {
    case '<': return A < B; case '>': return A > B; case '<=': return A <= B; case '>=': return A >= B;
    case '==': return A == B; case '!=': return A != B; // eslint-disable-line eqeqeq
  }
  return true;
}

/* ---------------- битовые картинки (для элемента «Картинка») ---------------- */

export function packBits(pixels, w, h) {
  // pixels: Uint8Array w*h (0/1) → base64
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  for (let i = 0; i < w * h; i++) if (pixels[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
function unpackBits(b64, w, h) {
  const s = atob(b64 || '');
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (s.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return out;
}
const bitsCache = new Map();

/** Картинка (img/canvas) → 1-бит w×h с дизерингом Флойда–Стейнберга или порогом */
export function imageToBits(img, w, h, { dither = true, threshold = 128, invert = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const k = Math.min(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const d = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255;
    let v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a;
    lum[i] = invert ? 255 - v : v;
  }
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = lum[i];
      const nv = old >= threshold ? 255 : 0;
      px[i] = nv ? 1 : 0;
      if (!dither) continue;
      const err = old - nv;
      if (x + 1 < w) lum[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) lum[i + w - 1] += (err * 3) / 16;
        lum[i + w] += (err * 5) / 16;
        if (x + 1 < w) lum[i + w + 1] += err / 16;
      }
    }
  }
  return packBits(px, w, h);
}

/* ---------------- состояние анимаций ---------------- */

const animState = new Map();
function rnd(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function drawAnim(g, el, t, v) {
  const { x, y, w, h } = el;
  const key = el.id || `${el.anim}${x}${y}`;
  let st = animState.get(key);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  const px = (a, b) => g.fillRect(Math.round(a), Math.round(b), 1, 1);
  switch (el.anim) {
    case 'stars': {
      if (!st) { const r = rnd(7); st = Array.from({ length: 40 }, () => ({ x: r() * w, y: r() * h, s: 0.3 + r() * 1.7 })); animState.set(key, st); }
      for (const s of st) { const xx = (s.x - t * 20 * s.s) % w; px(x + (xx < 0 ? xx + w : xx), y + s.y); if (s.s > 1.4) px(x + (xx < 0 ? xx + w : xx) + 1, y + s.y); }
      break;
    }
    case 'snow': {
      if (!st) { const r = rnd(3); st = Array.from({ length: 45 }, () => ({ x: r() * w, y: r() * h, s: 0.5 + r(), p: r() * 6 })); animState.set(key, st); }
      for (const s of st) px(x + ((s.x + Math.sin(t + s.p) * 3) % w + w) % w, y + ((s.y + t * 8 * s.s) % h));
      break;
    }
    case 'matrix': {
      const cols = Math.floor(w / 4);
      if (!st) { const r = rnd(11); st = Array.from({ length: cols }, () => ({ o: r() * 40, s: 10 + r() * 25 })); animState.set(key, st); }
      st.forEach((c, i) => {
        const head = ((t * c.s + c.o) % (h + 16)) - 4;
        for (let k = 0; k < 8; k++) { const yy = head - k * 2; if (yy >= 0 && yy < h && (k === 0 || ((i * 7 + k * 3 + Math.floor(t * 4)) % 3))) { px(x + i * 4 + 1, y + yy); if (k === 0) px(x + i * 4 + 2, y + yy); } }
      });
      break;
    }
    case 'eq': {
      const bands = (v._audio && v._audio.bands) || [];
      const n = 16, bw = w / n;
      for (let i = 0; i < n; i++) {
        const val = bands.length ? bands[Math.floor((i / n) * bands.length)] : 0.5 + 0.45 * Math.sin(t * 3 + i * 0.7) * Math.sin(t * 1.3 + i);
        const bh = Math.max(1, Math.round(val * h));
        g.fillRect(Math.round(x + i * bw), y + h - bh, Math.max(1, Math.round(bw) - 1), bh);
      }
      break;
    }
    case 'wave':
      for (let i = 0; i < w; i++) px(x + i, y + h / 2 + Math.sin(i / 8 + t * 4) * (h / 2 - 2) * Math.sin(t * 0.7 + i / 40));
      break;
    case 'bounce': {
      const bx = x + 3 + Math.abs(((t * 40) % ((w - 6) * 2)) - (w - 6));
      const by = y + h - 4 - Math.abs(Math.sin(t * 3)) * (h - 8);
      g.beginPath(); g.arc(bx, by, 3, 0, Math.PI * 2); g.fill();
      g.fillRect(x, y + h - 1, w, 1);
      break;
    }
    case 'life': {
      const cw = Math.floor(w / 2), ch = Math.floor(h / 2);
      if (!st || t - st.t > 0.2) {
        if (!st || st.gen > 150) { const r = rnd(Math.floor(t * 1000)); st = { t, gen: 0, c: Uint8Array.from({ length: cw * ch }, () => (r() < 0.3 ? 1 : 0)) }; }
        else {
          const n = new Uint8Array(cw * ch);
          for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) s += st.c[((yy + dy + ch) % ch) * cw + ((xx + dx + cw) % cw)];
            const a = st.c[yy * cw + xx];
            n[yy * cw + xx] = (a && (s === 2 || s === 3)) || (!a && s === 3) ? 1 : 0;
          }
          st = { t, gen: st.gen + 1, c: n };
        }
        animState.set(key, st);
      }
      for (let i = 0; i < cw * ch; i++) if (st.c[i]) g.fillRect(x + (i % cw) * 2, y + Math.floor(i / cw) * 2, 2, 2);
      break;
    }
    case 'typing': {
      const k = Math.min(1, (+v.wpm || 0) / 80);
      const bars = 24, bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const bh = Math.max(1, Math.round((0.15 + 0.85 * k) * h * (0.4 + 0.6 * Math.abs(Math.sin(t * (2 + k * 8) + i * 0.9)))));
        g.fillRect(Math.round(x + i * bw), y + (h - bh) / 2, Math.max(1, Math.round(bw) - 1), bh);
      }
      break;
    }
  }
  g.restore();
}

function drawIcon(g, el, v) {
  const s = el.scale || 1;
  g.save();
  g.translate(el.x, el.y);
  g.scale(s, s);
  const r = (x, y, w, h) => g.fillRect(x, y, w, h);
  switch (el.icon) {
    case 'battery': {
      g.strokeStyle = '#fff'; g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, 14, 7); r(15, 2, 2, 4);
      const lvl = Math.max(0, Math.min(100, +v.bat || 0));
      r(2, 2, Math.round((lvl / 100) * 11), 4);
      break;
    }
    case 'bt': [[3, 0], [3, 1], [4, 1], [3, 2], [5, 2], [1, 2], [3, 3], [2, 3], [4, 3], [3, 4], [3, 5], [2, 5], [4, 5], [1, 6], [3, 6], [5, 6], [3, 7], [4, 7], [3, 8]].forEach(([x, y]) => r(x, y, 1, 1)); break;
    case 'usb': r(3, 0, 1, 9); r(2, 1, 3, 1); r(1, 3, 1, 3); r(1, 5, 2, 1); r(5, 2, 1, 2); r(4, 4, 2, 1); r(2, 8, 3, 1); break;
    case 'heart': [[1, 0], [2, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [3, 4], [4, 4], [3, 5]].forEach(([x, y]) => r(x, y, 1, 1)); break;
    case 'star': [[3, 0], [3, 1], [2, 2], [3, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [2, 5], [4, 5], [1, 6], [5, 6]].forEach(([x, y]) => r(x, y, 1, 1)); break;
    case 'clock': g.strokeStyle = '#fff'; g.beginPath(); g.arc(4, 4, 3.5, 0, Math.PI * 2); g.stroke(); r(4, 2, 1, 3); r(4, 4, 2, 1); break;
    case 'bolt': [[3, 0], [2, 1], [3, 1], [1, 2], [2, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [2, 4], [3, 4], [1, 5], [2, 5], [1, 6]].forEach(([x, y]) => r(x, y, 1, 1)); break;
    case 'claude': for (let a = 0; a < 8; a++) { const ang = (a * Math.PI) / 4; for (let k = 1; k <= 3; k++) r(Math.round(4 + Math.cos(ang) * k), Math.round(4 + Math.sin(ang) * k), 1, 1); } r(4, 4, 1, 1); break;
    default: {
      const gl = GLYPHS[el.icon];
      if (gl) gl.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') r(x, y, 1, 1); }));
    }
  }
  g.restore();
}

function drawBits(g, b64, x0, y0, w, h) {
  const key = b64 + w + 'x' + h;
  let px = bitsCache.get(key);
  if (!px) { px = unpackBits(b64, w, h); bitsCache.set(key, px); if (bitsCache.size > 400) bitsCache.delete(bitsCache.keys().next().value); }
  for (let i = 0; i < w * h; i++) if (px[i]) g.fillRect(x0 + (i % w), y0 + Math.floor(i / w), 1, 1);
}

// Семисегментные цифры: a b c d e f g
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '', A: 'abcefg', b: 'cdefg', C: 'adef', d: 'bcdeg', E: 'adefg', F: 'aefg', H: 'bcefg', L: 'def', P: 'abefg', o: 'cdeg', u: 'cde', '°': 'abfg' };
function drawSeg(g, ch, x, y, w, h, t) {
  const segs = SEG[ch] ?? SEG[String(ch).toUpperCase()] ?? '';
  const m = Math.round(h / 2);
  const r = (a, b, c, d) => g.fillRect(Math.round(a), Math.round(b), Math.round(c), Math.round(d));
  if (segs.includes('a')) r(x + t, y, w - 2 * t, t);
  if (segs.includes('b')) r(x + w - t, y + t, t, m - t);
  if (segs.includes('c')) r(x + w - t, y + m, t, h - m - t);
  if (segs.includes('d')) r(x + t, y + h - t, w - 2 * t, t);
  if (segs.includes('e')) r(x, y + m, t, h - m - t);
  if (segs.includes('f')) r(x, y + t, t, m - t);
  if (segs.includes('g')) r(x + t, y + m - Math.floor(t / 2), w - 2 * t, t);
}

// История значений для графиков (по id элемента)
const histories = new Map();
function graphHistory(el, v, t) {
  let h = histories.get(el.id);
  if (!h) { h = { last: -1e9, data: [] }; histories.set(el.id, h); }
  if (t - h.last >= (el.step || 1)) {
    h.last = t;
    h.data.push(parseFloat(fillVars(el.value, v)) || 0);
    if (h.data.length > 128) h.data.shift();
  }
  return h.data;
}

const hitBoxes = [];
export function lastHitBoxes() { return hitBoxes; }

/**
 * Рисует страницу. Возвращает { bits: Uint8Array(512) для DISP IMG, canvas } .
 * v — значения переменных ({time} и т.д.), t — секунды.
 */
export function renderPage(page, v, t, canvas) {
  const c = canvas || document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  g.textBaseline = 'top';
  hitBoxes.length = 0;
  for (const el of page.elements || []) {
    if (el.hidden) continue;
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 1;
    if (!checkCond(el.cond, v)) continue;
    switch (el.type) {
      case 'text': {
        g.font = fontCss(el);
        let txt = fillVars(el.text, v);
        const full = g.measureText(txt).width;
        const fx = el.effect || 'none';
        if (fx === 'blink' && Math.floor(t * 2) % 2) { hitBoxes.push({ el, x: el.x, y: el.y, w: full, h: el.size }); break; }
        if (fx === 'type') { const cycle = txt.length * 0.12 + 2; txt = txt.slice(0, Math.floor((t % cycle) / 0.12)); }
        const x = el.align === 'center' ? el.x + (W - el.x) / 2 - full / 2 : el.align === 'right' ? W - el.x - full : el.x;
        let y = el.y;
        if (fx === 'box') { g.fillRect(Math.floor(x) - 2, y - 1, Math.ceil(full) + 4, el.size + 2); g.fillStyle = '#000'; }
        if (fx === 'shake') { g.fillText(txt, x + Math.round(Math.sin(t * 40)), y + Math.round(Math.cos(t * 33))); }
        else if (fx === 'wave') { let cx = x; for (const ch of txt) { g.fillText(ch, cx, y + Math.round(Math.sin(t * 6 + cx / 8) * 2)); cx += g.measureText(ch).width; } }
        else g.fillText(txt, x, y);
        g.fillStyle = '#fff';
        hitBoxes.push({ el, x, y: el.y, w: full, h: el.size });
        break;
      }
      case 'line':
        g.beginPath();
        if (el.dash) g.setLineDash([2, 2]);
        g.moveTo(el.x + 0.5, el.y + 0.5); g.lineTo(el.x2 + 0.5, el.y2 + 0.5); g.stroke();
        g.setLineDash([]);
        hitBoxes.push({ el, x: Math.min(el.x, el.x2), y: Math.min(el.y, el.y2) - 1, w: Math.abs(el.x2 - el.x) + 1, h: Math.abs(el.y2 - el.y) + 3 });
        break;
      case 'graph': {
        const hist = graphHistory(el, v, t);
        const lo = +el.min, hi = +el.max || 100;
        const n = el.w;
        const pts = hist.slice(-n);
        const yOf = (val) => el.y + el.h - 1 - Math.round(((Math.max(lo, Math.min(hi, val)) - lo) / (hi - lo || 1)) * (el.h - 1));
        const x0 = el.x + el.w - pts.length;
        if (el.style === 'bars') pts.forEach((val, i) => { if (i % 2 === 0) { const yy = yOf(val); g.fillRect(x0 + i, yy, 1, el.y + el.h - yy); } });
        else if (el.style === 'area') pts.forEach((val, i) => { const yy = yOf(val); g.fillRect(x0 + i, yy, 1, el.y + el.h - yy); });
        else { g.beginPath(); pts.forEach((val, i) => (i ? g.lineTo(x0 + i + 0.5, yOf(val) + 0.5) : g.moveTo(x0 + 0.5, yOf(val) + 0.5))); g.stroke(); }
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.w, h: el.h });
        break;
      }
      case 'gauge': {
        const val = Math.max(0, Math.min(100, parseFloat(fillVars(el.value, v)) || 0));
        const cx = el.x + el.r, cy = el.y + el.r, a0 = Math.PI * 0.75, a1 = a0 + Math.PI * 1.5 * (val / 100);
        g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, el.r - 0.5, a0, a0 + Math.PI * 1.5); g.stroke();
        g.lineWidth = el.thick; g.beginPath(); g.arc(cx, cy, el.r - el.thick / 2 - 1, a0, a1); g.stroke();
        g.lineWidth = 1;
        g.font = `bold ${Math.max(7, Math.round(el.r * 0.75))}px ${FONTS.sans}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(Math.round(val)), cx, cy + 1); g.textAlign = 'left'; g.textBaseline = 'top';
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.r * 2, h: el.r * 2 });
        break;
      }
      case 'clock': {
        const now = new Date();
        const cx = el.x + el.r, cy = el.y + el.r;
        g.beginPath(); g.arc(cx, cy, el.r - 0.5, 0, Math.PI * 2); g.stroke();
        if (el.ticks) for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; g.fillRect(Math.round(cx + Math.sin(a) * (el.r - 2.5)), Math.round(cy - Math.cos(a) * (el.r - 2.5)), 1, 1); }
        const hand = (ang, len, wdt) => { g.lineWidth = wdt; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len); g.stroke(); };
        const sec = now.getSeconds() + now.getMilliseconds() / 1000, min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
        hand((hr / 12) * Math.PI * 2, el.r * 0.5, 2);
        hand((min / 60) * Math.PI * 2, el.r * 0.8, 1);
        if (el.seconds) hand((sec / 60) * Math.PI * 2, el.r * 0.9, 1);
        g.lineWidth = 1;
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.r * 2, h: el.r * 2 });
        break;
      }
      case 'seg': {
        const txt = fillVars(el.text, v);
        const hgt = el.size, wd = Math.round(hgt * 0.5), th = Math.max(1, el.thick);
        let cx = el.x;
        for (const ch of txt) {
          if (ch === ':' || ch === '.') {
            if (ch === ':' && (Math.floor(t * 2) % 2 === 0 || !el.blink)) { g.fillRect(cx + 1, el.y + Math.round(hgt * 0.28), th, th); }
            if (ch === ':') g.fillRect(cx + 1, el.y + Math.round(hgt * 0.68), th, th);
            if (ch === '.') g.fillRect(cx + 1, el.y + hgt - th, th, th);
            cx += th + 3;
            continue;
          }
          drawSeg(g, ch, cx, el.y, wd, hgt, th);
          cx += wd + Math.max(2, th + 1);
        }
        hitBoxes.push({ el, x: el.x, y: el.y, w: cx - el.x, h: hgt });
        break;
      }
      case 'dots': {
        const cur = parseInt(fillVars(el.value, v), 10) || 0;
        for (let i = 0; i < el.count; i++) {
          const cx = el.x + el.r + i * el.gap, cy = el.y + el.r;
          g.beginPath(); g.arc(cx, cy, el.r, 0, Math.PI * 2);
          i === cur ? g.fill() : g.stroke();
        }
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.count * el.gap, h: el.r * 2 + 1 });
        break;
      }
      case 'keys': {
        const k = el.scale || 2;
        const pressed = v._pressed || new Set();
        const u = k * 2.25, sz = Math.max(2, Math.round(k * 2) - 1);
        for (const kk of v._keys || []) {
          const x = el.x + Math.round((kk.cx / 100) * u - sz / 2), y = el.y + Math.round((kk.cy / 100) * u - sz / 2);
          if (pressed.has(kk.pos)) g.fillRect(x, y, sz, sz);
          else if (sz > 2) { g.fillRect(x, y, sz, 1); g.fillRect(x, y + sz - 1, sz, 1); g.fillRect(x, y, 1, sz); g.fillRect(x + sz - 1, y, 1, sz); }
          else g.fillRect(x + 1, y + 1, 1, 1);
        }
        hitBoxes.push({ el, x: el.x, y: el.y, w: Math.round(14 * u), h: Math.round(4.6 * u) });
        break;
      }
      case 'gif': {
        const fr = el.frames || [];
        if (fr.length) {
          const total = fr.reduce((a, f) => a + (f.ms || 100), 0);
          let tt = (t * 1000) % total, i = 0;
          while (i < fr.length - 1 && tt >= (fr[i].ms || 100)) { tt -= fr[i].ms || 100; i++; }
          drawBits(g, fr[i].bits, el.x, el.y, el.w, el.h);
        }
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.w, h: el.h });
        break;
      }
      case 'marquee': {
        g.font = fontCss(el);
        const txt = fillVars(el.text, v) + '     ';
        const tw = g.measureText(txt).width;
        const off = (t * el.speed) % tw;
        g.fillText(txt, -off, el.y);
        g.fillText(txt, tw - off, el.y);
        hitBoxes.push({ el, x: 0, y: el.y, w: W, h: el.size });
        break;
      }
      case 'bar': {
        const val = Math.max(0, Math.min(100, parseFloat(fillVars(el.value, v)) || 0));
        g.strokeRect(el.x + 0.5, el.y + 0.5, el.w - 1, el.h - 1);
        g.fillRect(el.x + 2, el.y + 2, Math.round(((el.w - 4) * val) / 100), Math.max(1, el.h - 4));
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.w, h: el.h });
        break;
      }
      case 'frame':
        if (el.fill) g.fillRect(el.x, el.y, el.w, el.h);
        else if (el.radius) { g.beginPath(); g.roundRect(el.x + 0.5, el.y + 0.5, el.w - 1, el.h - 1, el.radius); g.stroke(); }
        else g.strokeRect(el.x + 0.5, el.y + 0.5, el.w - 1, el.h - 1);
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.w, h: el.h });
        break;
      case 'icon':
        drawIcon(g, el, v);
        hitBoxes.push({ el, x: el.x, y: el.y, w: 17 * (el.scale || 1), h: 9 * (el.scale || 1) });
        break;
      case 'image':
        drawBits(g, el.bits, el.x, el.y, el.w, el.h);
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.w, h: el.h });
        break;
      case 'anim':
        drawAnim(g, el, t, v);
        hitBoxes.push({ el, x: el.x, y: el.y, w: el.w, h: el.h });
        break;
    }
  }
  // Порог → 1 бит
  const d = g.getImageData(0, 0, W, H).data;
  const bits = new Uint8Array(512);
  for (let i = 0; i < W * H; i++) {
    let on = d[i * 4] > 110;
    if (page.invert) on = !on;
    if (on) bits[i >> 3] |= 0x80 >> (i & 7);
  }
  // Вид как на экране — для предпросмотра
  const out = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const on = (bits[i >> 3] >> (7 - (i & 7))) & 1;
    out.data[i * 4] = on ? 159 : 0; out.data[i * 4 + 1] = on ? 212 : 0; out.data[i * 4 + 2] = on ? 255 : 0; out.data[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return { bits, canvas: c };
}

export const bitsToHex = (bits) => Array.from(bits, (b) => b.toString(16).padStart(2, '0')).join('');

export function isAnimated(page) {
  return (page.elements || []).some((e) => ['anim', 'marquee', 'gif', 'keys', 'clock', 'seg'].includes(e.type)
    || (e.effect && e.effect !== 'none' && e.effect !== 'box') || (e.text || '').includes('{sec}'));
}

/** Переход между страницами: смешать две картинки (bits по 512 байт), k — 0..1 */
export function transition(a, b, k, kind) {
  if (!a || kind === 'none' || k >= 1) return b;
  const out = new Uint8Array(512);
  const get = (bits, x, y) => (x < 0 || x >= W || y < 0 || y >= H ? 0 : (bits[(y * W + x) >> 3] >> (7 - ((y * W + x) & 7))) & 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let on;
    if (kind === 'slide') { const off = Math.round(k * W); on = x < W - off ? get(a, x + off, y) : get(b, x - (W - off), y); }
    else if (kind === 'up') { const off = Math.round(k * H); on = y < H - off ? get(a, x, y + off) : get(b, x, y - (H - off)); }
    else { const r = ((x * 73 + y * 151 + x * y * 7) % 97) / 97; on = r < k ? get(b, x, y) : get(a, x, y); }
    if (on) out[(y * W + x) >> 3] |= 0x80 >> ((y * W + x) & 7);
  }
  return out;
}

/** Редактор пикселей: распаковать / упаковать картинку элемента */
export function bitsToPixels(b64, w, h) { return unpackBits(b64, w, h); }
export function pixelsToBits(px, w, h) { return packBits(px, w, h); }

/* ---------------- шаблоны страниц ---------------- */

let uid = 1;
export const newId = () => `e${Date.now().toString(36)}${uid++}`;
const el = (type, props) => ({ id: newId(), type, ...structuredClone(ELEMENT_TYPES[type].defaults), ...props });

export const TEMPLATES = {
  bigclock: { name: 'Большие часы', make: () => ({ elements: [el('text', { x: 0, y: 1, size: 26, bold: true, align: 'center', text: '{time}' })] }) },
  status: {
    name: 'Статус клавиатуры',
    make: () => ({ elements: [
      el('icon', { x: 0, y: 1, icon: 'battery' }), el('text', { x: 20, y: -1, size: 11, text: '{bat}%' }),
      el('icon', { x: 52, y: 0, icon: 'bt' }), el('text', { x: 60, y: -1, size: 11, text: 'BT{bt}' }),
      el('text', { x: 0, y: 0, size: 11, align: 'right', text: '{time}' }),
      el('text', { x: 0, y: 13, size: 17, bold: true, text: '{layer}' }),
    ] }),
  },
  hello: { name: 'Приветствие (кириллица)', make: () => ({ elements: [el('text', { x: 0, y: 0, size: 14, bold: true, align: 'center', text: 'Привет!' }), el('text', { x: 0, y: 17, size: 12, align: 'center', text: '{day}, {date}' })] }) },
  pc: {
    name: 'Загрузка ПК',
    make: () => ({ elements: [
      el('text', { x: 0, y: 0, size: 11, text: 'CPU {cpu}%' }), el('bar', { x: 58, y: 2, w: 70, h: 9, value: '{cpu}' }),
      el('text', { x: 0, y: 16, size: 11, text: 'RAM {ram}%' }), el('bar', { x: 58, y: 18, w: 70, h: 9, value: '{ram}' }),
    ] }),
  },
  weather: { name: 'Погода', make: () => ({ elements: [el('text', { x: 0, y: 0, size: 20, bold: true, text: '{temp}' }), el('text', { x: 0, y: 20, size: 11, text: '{weather}' }), el('anim', { anim: 'snow', x: 70, y: 0, w: 58, h: 32 })] }) },
  stars: { name: 'Звёздное небо + время', make: () => ({ elements: [el('anim', { anim: 'stars' }), el('text', { x: 0, y: 8, size: 16, bold: true, align: 'center', text: '{time}' })] }) },
  matrix: { name: 'Матрица', make: () => ({ elements: [el('anim', { anim: 'matrix' })] }) },
  eq: { name: 'Эквалайзер', make: () => ({ elements: [el('anim', { anim: 'eq' })] }) },
  typing: { name: 'Скорость печати', make: () => ({ elements: [el('anim', { anim: 'typing', x: 64, w: 64 }), el('text', { x: 0, y: 0, size: 22, bold: true, text: '{wpm}' }), el('text', { x: 0, y: 22, size: 9, text: 'слов/мин' })] }) },
  claude: { name: 'Статус Claude', make: () => ({ elements: [el('icon', { x: 0, y: 4, icon: 'claude', scale: 2 }), el('text', { x: 22, y: 0, size: 11, text: 'Claude' }), el('text', { x: 22, y: 14, size: 14, bold: true, text: '{claude}' })] }) },
  marquee: { name: 'Бегущая строка', make: () => ({ elements: [el('marquee', { y: 8, size: 16, text: 'Corne Studio · {time} · {weather}' })] }) },
  pomodoro: { name: 'Pomodoro', make: () => ({ elements: [el('icon', { x: 0, y: 2, icon: 'clock', scale: 2 }), el('text', { x: 0, y: 4, size: 22, bold: true, align: 'center', text: '{pomodoro}' })] }) },
  life: { name: 'Игра «Жизнь»', make: () => ({ elements: [el('anim', { anim: 'life' })] }) },
  pet: { name: 'Питомец', make: () => ({ elements: [el('text', { x: 0, y: 0, size: 12, align: 'center', text: '{pet}' }), el('anim', { anim: 'bounce', x: 0, y: 14, w: 128, h: 18 })] }) },
  analog: { name: 'Аналоговые часы + дата', make: () => ({ elements: [el('clock', { x: 1, y: 1, r: 15 }), el('text', { x: 38, y: 0, size: 16, bold: true, text: '{time}' }), el('text', { x: 38, y: 18, size: 11, text: '{day}' })] }) },
  segclock: { name: 'Электронные часы', make: () => ({ elements: [el('seg', { x: 6, y: 3, size: 26, text: '{time}', thick: 3, blink: true })] }) },
  cpugraph: { name: 'График CPU', make: () => ({ elements: [el('graph', { x: 0, y: 8, w: 128, h: 24, value: '{cpu}', style: 'area' }), el('text', { x: 0, y: -1, size: 9, text: 'CPU {cpu}%' }), el('text', { x: 0, y: -1, size: 9, align: 'right', text: 'RAM {ram}%' })] }) },
  gauges: { name: 'Кольца: батарея, CPU, RAM', make: () => ({ elements: [el('gauge', { x: 4, y: 2, value: '{bat}' }), el('gauge', { x: 49, y: 2, value: '{cpu}' }), el('gauge', { x: 94, y: 2, value: '{ram}' })] }) },
  keysmap: { name: 'Мини-клавиатура + скорость', make: () => ({ elements: [el('keys', { x: 0, y: 2, scale: 2 }), el('text', { x: 0, y: 6, size: 16, bold: true, align: 'right', text: '{wpm}' })] }) },
  layerdots: { name: 'Слой крупно + индикатор', make: () => ({ elements: [el('text', { x: 0, y: 0, size: 20, bold: true, align: 'center', text: '{layer}' }), el('dots', { x: 52, y: 26, count: 3, value: '{layernum}' })] }) },
  countdown: { name: 'Обратный отсчёт до даты', make: () => ({ elements: [el('text', { x: 0, y: 0, size: 11, align: 'center', text: 'До Нового года' }), el('text', { x: 0, y: 13, size: 18, bold: true, align: 'center', text: '{days:2026-12-31} дн.' })] }) },
  lowbat: { name: 'Предупреждение о батарее', make: () => ({ elements: [el('icon', { x: 4, y: 8, icon: 'warn', scale: 2, cond: '{bat} < 20' }), el('text', { x: 28, y: 8, size: 14, bold: true, effect: 'blink', text: 'Зарядите!', cond: '{bat} < 20' }), el('text', { x: 0, y: 8, size: 14, align: 'center', text: 'Заряд {bat}%', cond: '{bat} >= 20' })] }) },
  blank: { name: 'Пустая страница', make: () => ({ elements: [] }) },
};

export function makePage(templateId = 'status') {
  const t = TEMPLATES[templateId] || TEMPLATES.status;
  return { id: newId(), name: t.name, duration: 8, invert: false, ...t.make() };
}
