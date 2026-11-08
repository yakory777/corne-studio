// Палитра клавиш для редактора слоёв: клик по кнопке — привязка для выбранной клавиши.
import { keyLabel } from './keymap.js';

const kp = (list) => list.map((k) => `&kp ${k}`);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const CATEGORIES = [
  { id: 'letters', name: 'Буквы', items: () => kp(LETTERS) },
  { id: 'nums', name: 'Цифры и F', items: () => kp(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N0', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]) },
  { id: 'sym', name: 'Символы', items: () => kp(['MINUS', 'EQUAL', 'LBKT', 'RBKT', 'BSLH', 'SEMI', 'SQT', 'GRAVE', 'COMMA', 'DOT', 'FSLH', 'EXCL', 'AT', 'HASH', 'DOLLAR', 'PRCNT', 'CARET', 'AMPS', 'STAR', 'LPAR', 'RPAR', 'UNDER', 'PLUS', 'LBRC', 'RBRC', 'PIPE', 'COLON', 'DQT', 'LT', 'GT', 'QMARK', 'TILDE']) },
  { id: 'ctl', name: 'Управление', items: () => kp(['ESC', 'TAB', 'SPACE', 'RET', 'BSPC', 'DEL', 'CAPS', 'INS', 'PSCRN', 'LSHFT', 'RSHFT', 'LCTRL', 'RCTRL', 'LALT', 'RALT', 'LGUI', 'RGUI']) },
  { id: 'nav', name: 'Навигация', items: () => kp(['LEFT', 'DOWN', 'UP', 'RIGHT', 'HOME', 'END', 'PG_UP', 'PG_DN']) },
  { id: 'media', name: 'Медиа', items: () => kp(['C_VOL_UP', 'C_VOL_DN', 'C_MUTE', 'C_PP', 'C_NEXT', 'C_PREV', 'C_BRI_UP', 'C_BRI_DN']) },
  {
    id: 'layers', name: 'Слои',
    items: (layers) => layers.flatMap((l, i) => [`&mo ${i}`, `&tog ${i}`, `&to ${i}`]),
  },
  {
    id: 'sys', name: 'Bluetooth и система',
    items: () => [
      ...[0, 1, 2, 3, 4].map((i) => `&bt BT_SEL ${i}`), '&bt BT_CLR', '&bt BT_NXT', '&bt BT_PRV',
      '&out OUT_USB', '&out OUT_BLE', '&out OUT_TOG', '&bootloader', '&sys_reset',
    ],
  },
  {
    id: 'rgb', name: 'Подсветка',
    items: () => ['RGB_TOG', 'RGB_ON', 'RGB_OFF', 'RGB_EFF', 'RGB_EFR', 'RGB_HUI', 'RGB_HUD', 'RGB_SAI', 'RGB_SAD', 'RGB_BRI', 'RGB_BRD', 'RGB_SPI', 'RGB_SPD'].map((c) => `&rgb_ug ${c}`),
  },
  { id: 'snip', name: 'Сниппеты', items: () => Array.from({ length: 12 }, (_, i) => `&kp F${13 + i}`) },
  { id: 'special', name: 'Особые', items: () => ['&trans', '&none', '&caps_word', '&key_repeat'] },
];

const TIPS = {
  '&trans': 'прозрачная — берёт клавишу с нижнего слоя', '&none': 'ничего не делает',
  '&caps_word': 'Caps до конца слова', '&key_repeat': 'повторить последнюю клавишу',
  '&bootloader': 'режим прошивки этой половины', '&sys_reset': 'перезагрузка',
  '&out OUT_USB': 'печатать по USB', '&out OUT_BLE': 'печатать по Bluetooth', '&out OUT_TOG': 'переключить USB/BT',
  '&bt BT_CLR': 'забыть текущее Bluetooth-устройство',
};

/** Добавляет модификаторы: &kp A + [LC, LS] → &kp LC(LS(A)) */
export function withMods(binding, mods) {
  if (!mods.length || !binding.startsWith('&kp ')) return binding;
  let k = binding.slice(4);
  for (const m of [...mods].reverse()) k = `${m}(${k})`;
  return `&kp ${k}`;
}

/** Нужные #include для использованных поведений. */
export function ensureIncludes(text) {
  const need = [
    ['&kp ', 'dt-bindings/zmk/keys.h'],
    ['&bt ', 'dt-bindings/zmk/bt.h'],
    ['&rgb_ug ', 'dt-bindings/zmk/rgb.h'],
    ['&out ', 'dt-bindings/zmk/outputs.h'],
  ];
  const add = need.filter(([b, h]) => text.includes(b) && !text.includes(`<${h}>`)).map(([, h]) => `#include <${h}>`);
  if (!add.length) return text;
  const idx = text.indexOf('#include <behaviors.dtsi>');
  if (idx >= 0) {
    const end = text.indexOf('\n', idx) + 1;
    return text.slice(0, end) + add.join('\n') + '\n' + text.slice(end);
  }
  return add.join('\n') + '\n' + text;
}

export function renderPicker(container, { getLayers, onPick }) {
  let cat = 'letters';
  const mods = new Set();
  container.innerHTML = `
    <div class="row wrap picker-cats"></div>
    <div class="row wrap picker-mods">
      <span class="muted">Удерживать вместе:</span>
      ${[['LC', 'Ctrl'], ['LS', 'Shift'], ['LA', 'Alt'], ['LG', 'Win']].map(([m, n]) => `<label class="check"><input type="checkbox" data-mod="${m}"> ${n}</label>`).join('')}
    </div>
    <div class="picker-grid"></div>`;
  const cats = container.querySelector('.picker-cats');
  const grid = container.querySelector('.picker-grid');

  function draw() {
    cats.innerHTML = '';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'sub' + (c.id === cat ? ' active' : '');
      b.textContent = c.name;
      b.onclick = () => { cat = c.id; draw(); };
      cats.appendChild(b);
    }
    grid.innerHTML = '';
    const layers = getLayers();
    const c = CATEGORIES.find((x) => x.id === cat);
    for (const binding of c.items(layers)) {
      const b = document.createElement('button');
      b.className = 'pk';
      b.textContent = keyLabel(binding, layers);
      b.title = `${binding}${TIPS[binding] ? ' — ' + TIPS[binding] : ''}`;
      b.onclick = () => onPick(withMods(binding, [...mods]));
      grid.appendChild(b);
    }
  }
  container.querySelectorAll('[data-mod]').forEach((cb) => {
    cb.onchange = () => (cb.checked ? mods.add(cb.dataset.mod) : mods.delete(cb.dataset.mod));
  });
  draw();
  return { redraw: draw };
}
