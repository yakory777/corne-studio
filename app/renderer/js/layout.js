// Геометрия Corne (6 колонок) — из ZMK foostan_corne_6col_layout — и карта светодиодов Corne v3.

// [w, h, x, y, rot(сотые градуса), rx, ry] в сотых долях клавиши
const RAW = [
  [100, 100, 0, 37, 0, 0, 0], [100, 100, 100, 37, 0, 0, 0], [100, 100, 200, 12, 0, 0, 0],
  [100, 100, 300, 0, 0, 0, 0], [100, 100, 400, 12, 0, 0, 0], [100, 100, 500, 24, 0, 0, 0],
  [100, 100, 800, 24, 0, 0, 0], [100, 100, 900, 12, 0, 0, 0], [100, 100, 1000, 0, 0, 0, 0],
  [100, 100, 1100, 12, 0, 0, 0], [100, 100, 1200, 37, 0, 0, 0], [100, 100, 1300, 37, 0, 0, 0],
  [100, 100, 0, 137, 0, 0, 0], [100, 100, 100, 137, 0, 0, 0], [100, 100, 200, 112, 0, 0, 0],
  [100, 100, 300, 100, 0, 0, 0], [100, 100, 400, 112, 0, 0, 0], [100, 100, 500, 124, 0, 0, 0],
  [100, 100, 800, 124, 0, 0, 0], [100, 100, 900, 112, 0, 0, 0], [100, 100, 1000, 100, 0, 0, 0],
  [100, 100, 1100, 112, 0, 0, 0], [100, 100, 1200, 137, 0, 0, 0], [100, 100, 1300, 137, 0, 0, 0],
  [100, 100, 0, 237, 0, 0, 0], [100, 100, 100, 237, 0, 0, 0], [100, 100, 200, 212, 0, 0, 0],
  [100, 100, 300, 200, 0, 0, 0], [100, 100, 400, 212, 0, 0, 0], [100, 100, 500, 224, 0, 0, 0],
  [100, 100, 800, 224, 0, 0, 0], [100, 100, 900, 212, 0, 0, 0], [100, 100, 1000, 200, 0, 0, 0],
  [100, 100, 1100, 212, 0, 0, 0], [100, 100, 1200, 237, 0, 0, 0], [100, 100, 1300, 237, 0, 0, 0],
  [100, 100, 350, 312, 0, 0, 0], [100, 100, 450, 312, 1200, 450, 412],
  [100, 150, 548, 283, 2400, 548, 433], [100, 150, 752, 283, -2400, 852, 433],
  [100, 100, 850, 312, -1200, 950, 412], [100, 100, 950, 312, 0, 0, 0],
];

function rotatePoint(x, y, deg, rx, ry) {
  const a = (deg * Math.PI) / 180;
  const dx = x - rx, dy = y - ry;
  return [rx + dx * Math.cos(a) - dy * Math.sin(a), ry + dx * Math.sin(a) + dy * Math.cos(a)];
}

export const KEYS = RAW.map(([w, h, x, y, rot, rx, ry], pos) => {
  const deg = rot / 100;
  const [cx, cy] = rotatePoint(x + w / 2, y + h / 2, deg, rx, ry);
  return { pos, w, h, x, y, deg, rx, ry, cx, cy, half: x < 700 ? 'L' : 'R' };
});

// Индекс светодиода на своей половине (Corne v3: 0–5 подсветка снизу, 6–26 под клавишами)
const LEFT_LED = {
  0: 24, 1: 23, 2: 18, 3: 17, 4: 10, 5: 9,
  12: 25, 13: 22, 14: 19, 15: 16, 16: 11, 17: 8,
  24: 26, 25: 21, 26: 20, 27: 15, 28: 12, 29: 7,
  36: 14, 37: 13, 38: 6,
};
const MIRROR = {
  0: 11, 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 12: 23, 13: 22, 14: 21, 15: 20, 16: 19, 17: 18,
  24: 35, 25: 34, 26: 33, 27: 32, 28: 31, 29: 30, 36: 41, 37: 40, 38: 39,
};
export const DEFAULT_LED_MAP = {};
for (const [p, led] of Object.entries(LEFT_LED)) {
  DEFAULT_LED_MAP[p] = led;
  DEFAULT_LED_MAP[MIRROR[p]] = led;
}

// Подсветка снизу (примерные места, в сотых клавиши, левая половина)
const UNDER_LEFT = [[580, 120], [360, 90], [150, 150], [150, 260], [360, 320], [580, 340]];

export const LEDS_PER_HALF = 27;

/** Все светодиоды обеих половин с координатами (центр, в единицах клавиш). */
export function buildLeds(ledMap = DEFAULT_LED_MAP) {
  const leds = [];
  for (const k of KEYS) {
    const idx = ledMap[k.pos];
    if (idx === undefined) continue;
    leds.push({ half: k.half, index: idx, pos: k.pos, under: false, x: k.cx / 100, y: k.cy / 100 });
  }
  UNDER_LEFT.forEach(([x, y], i) => {
    leds.push({ half: 'L', index: i, pos: null, under: true, x: x / 100, y: y / 100 });
    leds.push({ half: 'R', index: i, pos: null, under: true, x: (1400 - x) / 100, y: y / 100 });
  });
  return leds;
}

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

/**
 * Рисует клавиатуру в контейнер. Возвращает объект для обновления:
 * setLabel(pos, text), setKeyColor(pos, css), setPressed(pos, bool), setClass(pos, cls, on),
 * setLed(half, index, css), onKeyClick(cb)
 */
export function renderKeyboard(container, { showLeds = true, ledMap = DEFAULT_LED_MAP } = {}) {
  container.innerHTML = '';
  const svg = el('svg', { viewBox: '-20 -20 1440 500', class: 'kb' }, container);
  const keyEls = {};
  const ledEls = {};
  let clickCb = null;

  // Подсветка снизу — под клавишами
  const under = el('g', { class: 'under' }, svg);

  for (const k of KEYS) {
    const g = el('g', { class: 'key', 'data-pos': k.pos }, svg);
    if (k.deg) g.setAttribute('transform', `rotate(${k.deg} ${k.rx} ${k.ry})`);
    const rect = el('rect', { x: k.x + 4, y: k.y + 4, width: k.w - 8, height: k.h - 8, rx: 10 }, g);
    const glow = el('rect', { class: 'glow', x: k.x + 4, y: k.y + 4, width: k.w - 8, height: k.h - 8, rx: 10 }, g);
    const label = el('text', { x: k.x + k.w / 2, y: k.y + k.h / 2 + 6, 'text-anchor': 'middle' }, g);
    const idx = el('text', { class: 'idx', x: k.x + 12, y: k.y + 22 }, g);
    keyEls[k.pos] = { g, rect, glow, label, idx };
    g.addEventListener('click', () => clickCb && clickCb(k.pos));
  }

  if (showLeds) {
    for (const led of buildLeds(ledMap)) {
      const c = el('circle', { cx: led.x * 100, cy: led.y * 100 + (led.under ? 0 : 30), r: led.under ? 14 : 7, class: led.under ? 'led under-led' : 'led' }, led.under ? under : svg);
      ledEls[`${led.half}${led.index}`] = c;
    }
  }

  return {
    svg,
    setLabel(pos, text) {
      const e = keyEls[pos];
      if (!e) return;
      e.label.textContent = text;
      e.label.setAttribute('font-size', text.length > 7 ? 12 : text.length > 5 ? 15 : text.length > 3 ? 19 : 24);
    },
    setIndex(pos, text) { keyEls[pos] && (keyEls[pos].idx.textContent = text); },
    setKeyColor(pos, css) { keyEls[pos] && (keyEls[pos].glow.style.fill = css || 'transparent'); },
    setClass(pos, cls, on) { keyEls[pos] && keyEls[pos].g.classList.toggle(cls, !!on); },
    clearClass(cls) { Object.values(keyEls).forEach((e) => e.g.classList.remove(cls)); },
    setLed(half, index, css) { const c = ledEls[`${half}${index}`]; c && (c.style.fill = css); },
    onKeyClick(cb) { clickCb = cb; },
  };
}
