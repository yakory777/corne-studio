// Эффекты подсветки. Каждый эффект: (led, t, p, ctx) => [r, g, b] (0..255).
// led: { half, index, pos, under, x, y } — координаты в единицах клавиш (вся клавиатура 0..14).
// t — время в секундах, p — параметры, ctx — { presses: [{x, y, t, pos}], layer, pressed: Set }

export function hexToRgb(h) {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex([r, g, b]) {
  return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function hsv(h, s = 1, v = 1) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
export const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, k)));
const scale = (c, k) => c.map((v) => v * k);
const centerOf = (led) => (led.half === 'L' ? [3.5, 2.2] : [10.5, 2.2]);

const LAYER_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#eab308'];

export const EFFECTS = {
  solid: {
    name: 'Сплошной цвет',
    params: ['color1'],
    fn: (led, t, p) => hexToRgb(p.color1),
  },
  gradient: {
    name: 'Градиент',
    params: ['color1', 'color2'],
    fn: (led, t, p) => mix(hexToRgb(p.color1), hexToRgb(p.color2), led.x / 14),
  },
  rainbow: {
    name: 'Радуга-волна',
    params: ['speed', 'size'],
    fn: (led, t, p) => hsv(led.x * (360 / (14 * p.size)) - t * 90 * p.speed),
  },
  breathe: {
    name: 'Дыхание',
    params: ['color1', 'speed'],
    fn: (led, t, p) => scale(hexToRgb(p.color1), 0.08 + 0.92 * (0.5 + 0.5 * Math.sin(t * 2.5 * p.speed))),
  },
  swirl: {
    name: 'Вихрь',
    params: ['speed'],
    fn: (led, t, p) => {
      const [cx, cy] = centerOf(led);
      const a = (Math.atan2(led.y - cy, led.x - cx) * 180) / Math.PI;
      return hsv(a + t * 120 * p.speed * (led.half === 'L' ? 1 : -1));
    },
  },
  ripple: {
    name: 'Круги от нажатия',
    params: ['color1', 'color2', 'speed'],
    reactive: true,
    fn: (led, t, p, ctx) => {
      let k = 0;
      for (const pr of ctx.presses) {
        const age = t - pr.t;
        if (age > 2) continue;
        const r = age * 6 * p.speed;
        const d = Math.hypot(led.x - pr.x, led.y - pr.y);
        k = Math.max(k, Math.max(0, 1 - Math.abs(d - r) / 0.9) * (1 - age / 2));
      }
      return mix(scale(hexToRgb(p.color2), 0.15), hexToRgb(p.color1), k);
    },
  },
  heat: {
    name: 'След нажатий',
    params: ['color1', 'color2'],
    reactive: true,
    fn: (led, t, p, ctx) => {
      let k = 0;
      for (const pr of ctx.presses) {
        if (pr.pos === led.pos) k = Math.max(k, 1 - (t - pr.t) / 1.2);
      }
      if (ctx.pressed.has(led.pos)) k = 1;
      return mix(scale(hexToRgb(p.color2), 0.1), hexToRgb(p.color1), k);
    },
  },
  fire: {
    name: 'Огонь',
    params: ['speed'],
    fn: (led, t, p) => {
      const n = Math.sin(led.x * 3.1 + t * 7 * p.speed) * Math.sin(led.y * 2.3 - t * 5 * p.speed) * 0.5 + 0.5;
      const heat = Math.max(0, Math.min(1, n * 0.8 + (led.y / 4.5) * 0.4));
      return mix([60, 0, 0], [255, 170, 20], heat);
    },
  },
  layer: {
    name: 'Цвет слоя',
    params: [],
    fn: (led, t, p, ctx) => hexToRgb(LAYER_COLORS[ctx.layer % LAYER_COLORS.length]),
  },
  eq: {
    name: 'Эквалайзер (звук ПК) ♪',
    params: ['color1', 'color2'],
    audio: true,
    fn: (led, t, p, ctx) => {
      const a = ctx.audio;
      if (!a) return [0, 0, 0];
      if (led.under) return mix([0, 0, 0], hexToRgb(p.color2), a.level * 1.6);
      const col = Math.max(0, Math.min(13, Math.floor(led.x)));
      const v = a.bands[col];
      const h = 1 - Math.min(1, led.y / 4.3); // 1 — верхний ряд
      if (v < 1 - h * 0.85) return [0, 0, 0];
      return mix(hexToRgb(p.color2), hexToRgb(p.color1), h);
    },
  },
  bass: {
    name: 'Пульс басов ♪',
    params: ['color1'],
    audio: true,
    fn: (led, t, p, ctx) => {
      const a = ctx.audio;
      if (!a) return [0, 0, 0];
      const bass = (a.bands[0] + a.bands[1] + a.bands[2]) / 3;
      return scale(hexToRgb(p.color1), Math.min(1, bass * bass * 1.4));
    },
  },
  code: {
    name: 'Свой код (JS)',
    params: ['speed', 'color1', 'color2'],
    fn: null, // компилируется из p.code
  },
};

export const DEFAULT_PARAMS = {
  color1: '#ff3d7f',
  color2: '#3d7fff',
  speed: 1,
  size: 1,
  brightness: 0.5,
  code: `// led: {half, index, pos, under, x, y}; t — секунды
// helpers: hsv(h,s,v), mix(a,b,k), hex('#rrggbb')
const d = Math.hypot(led.x - 7, led.y - 2);
return hsv(d * 40 - t * 120 * p.speed, 1, 1);`,
};

export function compileCode(code) {
  // eslint-disable-next-line no-new-func
  const f = new Function('led', 't', 'p', 'ctx', 'hsv', 'mix', 'hex', code);
  return (led, t, p, ctx) => f(led, t, p, ctx, hsv, mix, hexToRgb);
}

/** Возвращает функцию для расчёта цвета светодиода по эффекту и параметрам. */
export function makeRenderer(effectId, params) {
  const eff = EFFECTS[effectId] || EFFECTS.solid;
  let fn = eff.fn;
  if (effectId === 'code') {
    fn = compileCode(params.code || DEFAULT_PARAMS.code);
  }
  return (led, t, ctx) => {
    let c;
    try { c = fn(led, t, params, ctx) || [0, 0, 0]; } catch { c = [255, 0, 0]; }
    return scale(c, params.brightness ?? 1);
  };
}
