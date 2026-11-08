import { Link, parseInfo } from './serial.js';
import { renderKeyboard, buildLeds, DEFAULT_LED_MAP, LEDS_PER_HALF, KEYS } from './layout.js';
import { EFFECTS, DEFAULT_PARAMS, makeRenderer, rgbToHex, hsv } from './effects.js';
import { parseKeymap, serializeKeymap, keyLabel } from './keymap.js';
import { initBuild } from './build.js';
import { initStats } from './stats.js';
import { renderPicker, ensureIncludes } from './picker.js';
import { heldCombo, allSets, setForProcess, isModifierBinding } from './hotkeys.js';
import { initTrainer } from './trainer.js';
import { initProfiles } from './profiles.js';
import { DEFAULT_LAYERS } from './default-keymap.js';
import { audio, startAudio, stopAudio } from './audio.js';
import { initGames, initAchievements } from './games.js';
import { initTools } from './tools.js';
import { DemoDevice, zmkName } from './demo.js';
import { initScreenDesigner } from './screen-designer.js';

let designer = null;
let lastKeyTime = performance.now();
let sysCache = { cpu: 0, ram: 0 };

let demo = null;

let games = null;
let tools = null;

let trainer = null;
let hotkeyPref = 'auto';
let activeProc = '';
const getLayers = () => (state.keymap ? state.keymap.model.layers : DEFAULT_LAYERS);

let stats = null;
let picker = null;
const lastRelease = {};
const bounces = {};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const cs = window.cs;

const link = new Link();
let settings = {};
const state = {
  info: {},
  activeLayers: new Set([0]),
  layer: 0,
  pressed: new Set(),
  presses: [],
  counts: {},
  tested: new Set(),
  keymap: null, // { model, path, cur, sel, dirty }
};

// Стандартная раскладка Corne для подписей, пока файл keymap не открыт
const DEFAULT_LABELS = [
  'Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '⌫',
  'Ctrl', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'",
  '⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Esc',
  'Win', '↑1', '␣', '⏎', '↑2', 'AltGr',
];

/* ================= утилиты ================= */

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 3000);
}

async function saveSettings(patch) {
  Object.assign(settings, patch);
  await cs.store.set(patch);
}

function requireLink() {
  if (!link.connected) {
    toast('Сначала подключите главную половину по USB', true);
    return false;
  }
  return true;
}

async function cmd(text) {
  if (!requireLink()) return null;
  try {
    return await link.request(text);
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

/** Какая половина главная: по ответу клавиатуры, иначе по выбору на вкладке «Прошивка» */
const mainSide = () => state.info.side || settings.mainSide || 'left';
const MH = () => (mainSide() === 'right' ? 'R' : 'L');
const sideName = (s, form = 'им') => ({ left: { им: 'левая', вин: 'левую', род: 'левой' }, right: { им: 'правая', вин: 'правую', род: 'правой' } }[s][form]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Модалка выбора из списка. items: [{label, sub, value}] */
function pick(title, items, { input } = {}) {
  return new Promise((resolve) => {
    $('#pickTitle').textContent = title;
    const list = $('#pickList');
    list.innerHTML = '';
    const done = (v) => { $('#pickModal').classList.add('hidden'); resolve(v); };
    if (input !== undefined) {
      const inp = document.createElement('input');
      inp.value = input;
      inp.className = 'grow';
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = 'OK';
      const row = document.createElement('div');
      row.className = 'row';
      row.append(inp, ok);
      list.appendChild(row);
      ok.onclick = () => done(inp.value.trim() || null);
      inp.onkeydown = (e) => e.key === 'Enter' && ok.onclick();
      setTimeout(() => inp.focus(), 0);
    }
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'item';
      d.innerHTML = `<span class="grow"></span><span class="muted"></span>`;
      d.children[0].textContent = it.label;
      d.children[1].textContent = it.sub || '';
      d.onclick = () => done(it.value);
      list.appendChild(d);
    }
    $('#pickCancel').onclick = () => done(null);
    $('#pickModal').classList.remove('hidden');
  });
}

/* ================= клавиатуры на экране ================= */

const kbs = {};

function labelsFor(layerIdx) {
  const km = state.keymap;
  if (km) {
    const l = km.model.layers[layerIdx] || km.model.layers[0];
    return l.bindings.map((b) => keyLabel(b, km.model.layers));
  }
  return DEFAULT_LABELS;
}

function applyLabels(kb, layerIdx = 0) {
  const labels = labelsFor(layerIdx);
  KEYS.forEach((k) => {
    kb.setLabel(k.pos, labels[k.pos] || '');
    kb.setClass(k.pos, 'trans', labels[k.pos] === '▽');
  });
}

function initKeyboards() {
  kbs.overview = renderKeyboard($('#overviewKb'), { showLeds: false });
  kbs.layers = renderKeyboard($('#layersKb'), { showLeds: false });
  kbs.light = renderKeyboard($('#lightKb'));
  kbs.debug = renderKeyboard($('#debugKb'), { showLeds: false });
  kbs.leds = renderKeyboard($('#ledKb'));
  kbs.demo = renderKeyboard($('#demoKb'));
  Object.values(kbs).forEach((kb) => applyLabels(kb));
  KEYS.forEach((k) => {
    const idx = DEFAULT_LED_MAP[k.pos];
    kbs.leds.setIndex(k.pos, idx !== undefined ? String(idx) : '');
  });
  kbs.layers.onKeyClick(selectKeymapKey);
  kbs.leds.onKeyClick((pos) => {
    if (KEYS[pos].half === MH() && DEFAULT_LED_MAP[pos] !== undefined) {
      $('#ledIdx').value = DEFAULT_LED_MAP[pos];
      onLedIdx();
      ledShowOne();
    }
  });
}

/* ================= вкладки ================= */

const TITLES = { overview: 'Обзор', layers: 'Слои', lighting: 'Подсветка', screen: 'Экран', profiles: 'Профили', trainer: 'Тренажёр', games: 'Игры', tools: 'Инструменты', stats: 'Статистика', firmware: 'Прошивка', debug: 'Дебаг' };
let currentTab = 'overview';

function showTab(name) {
  currentTab = name;
  if (name === 'stats' && stats) setTimeout(() => stats.render(), 0);
  if (trainer) (name === 'trainer' ? trainer.onTab() : trainer.stop());
  if (games) (name === 'games' ? games.onTab() : games.stop());
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $('#tabTitle').textContent = TITLES[name];
}

/* ================= соединение ================= */

/* ================= демо-режим ================= */

async function startDemo() {
  if (link.connected) await link.disconnect();
  demo = new DemoDevice({ side: settings.mainSide || 'right' });
  demo.onChange(renderDemo);
  await link.open(demo);
  $('#demoCard').hidden = false;
  toast('Демо-режим: виртуальная клавиатура. Печатайте на клавиатуре компьютера — нажатия пойдут как с Corne. F1/F2 — слои Lower/Raise.');
}

function renderDemo() {
  if (!demo) return;
  // Подсветка виртуальной клавиатуры
  const h = MH();
  const byIndex = {};
  KEYS.forEach((k) => { if (k.half === h && DEFAULT_LED_MAP[k.pos] !== undefined) byIndex[DEFAULT_LED_MAP[k.pos]] = k.pos; });
  const lit = demo.hostLed || demo.rgbOn;
  for (let i = 0; i < 27; i++) {
    const c = demo.hostLed ? demo.frame[i] : demo.rgbOn ? [70, 40, 160] : [0, 0, 0];
    const css = lit && c.some((v) => v > 4) ? `rgb(${c.map((v) => Math.min(255, v * 1.5 + 20) | 0).join(',')})` : '';
    if (byIndex[i] !== undefined) kbs.demo.setKeyColor(byIndex[i], css);
    kbs.demo.setLed(h, i, css || '#2a2f3a');
  }
  // OLED
  const c = $('#demoOled').getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, 128, 32);
  c.fillStyle = '#9fd4ff';
  if (demo.display.test === 1) { c.fillRect(0, 0, 128, 32); return; }
  if (demo.display.test === 2) { c.strokeStyle = '#9fd4ff'; c.strokeRect(0.5, 0.5, 127, 31); c.font = '8px sans-serif'; c.fillText('128 x 32', 44, 19); return; }
  if (demo.display.imgMode && demo.display.img) {
    const im = c.createImageData(128, 32);
    for (let p = 0; p < 4096; p++) {
      const on = (demo.display.img[p >> 3] >> (7 - (p & 7))) & 1;
      im.data[p * 4] = on ? 159 : 0; im.data[p * 4 + 1] = on ? 212 : 0; im.data[p * 4 + 2] = on ? 255 : 0; im.data[p * 4 + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    return;
  }
  c.font = '8px "Segoe UI", sans-serif'; c.textBaseline = 'top';
  const i = state.info;
  const lines = [...demo.display.lines];
  if (demo.display.auto) lines[0] = `${i.layer_name || 'QWERTY'}  BT1  ${i.bat ?? demo.bat}%`;
  lines.forEach((l, n) => c.fillText(l || '', 0, n * 10 + 1));
}

// Нажатия клавиш компьютера → виртуальная клавиатура
function demoKey(e, down) {
  if (!demo || !link.connected) return;
  if (e.code === 'F1' || e.code === 'F2') {
    if (!e.repeat) demo.layer(e.code === 'F1' ? 1 : 2, down);
    e.preventDefault();
    return;
  }
  const name = zmkName(e.code);
  if (!name || e.repeat) return;
  const layer0 = getLayers()[0].bindings;
  const pos = layer0.findIndex((b) => b === `&kp ${name}`);
  if (pos >= 0) demo.key(pos, down);
}
window.addEventListener('keydown', (e) => demoKey(e, true));
window.addEventListener('keyup', (e) => demoKey(e, false));

function setConnected(on) {
  $('#connPill').classList.toggle('on', on);
  $('#connText').textContent = on ? `${demo ? 'Демо' : 'Подключено'}${state.info.side ? ' · ' + sideName(state.info.side) : ''}` : 'Не подключено';
  $('#demoBtn').hidden = on;
  $('#connectBtn').textContent = on ? 'Отключить' : 'Подключить';
}

function renderInfo() {
  const i = state.info;
  const fmt = {
    role: i.side ? `${sideName(i.side)}${i.role === 'central' ? ' (главная)' : ''}`.replace(/^./, (c) => c.toUpperCase()) : '—',
    fw: i.fw ? `corne-tool ${i.fw}` : '—',
    bat: i.bat !== undefined ? `${i.bat}%` : '—',
    usb: i.usb === '1' ? 'есть питание' : i.usb === '0' ? 'нет' : '—',
    profile: i.profile !== undefined && +i.profile >= 0 ? `BT${+i.profile + 1}` : '—',
    layer_name: i.layer_name ? `${i.layer_name} (${i.layer})` : '—',
    leds: i.leds ?? '—',
    rgb: i.host_led === '1' ? 'управляет приложение' : i.rgb === '1' ? 'включена' : i.rgb === '0' ? 'выключена' : '—',
    display: i.display === '1' ? 'есть' : i.display === '0' ? 'выключен в прошивке' : '—',
  };
  $$('[data-info]').forEach((el) => { el.textContent = fmt[el.dataset.info]; });
  setConnected(link.connected);
}

let infoTimer = null;

link.addEventListener('open', async () => {
  setConnected(true);
  toast('Клавиатура подключена');
  try {
    await sleep(150);
    await link.request('INFO', 'INFO', 2000);
    await link.request('KEYS 1');
  } catch (e) {
    toast('Порт открыт, но модуль не отвечает: ' + e.message, true);
  }
  clearInterval(infoTimer);
  infoTimer = setInterval(() => link.connected && link.write('INFO'), 3000);
  // Восстановить экран, если был живой режим
  if (screenLive) sendScreen();
  if (designer) designer.resend();
});

link.addEventListener('close', () => {
  clearInterval(infoTimer);
  if (demo) { demo = null; $('#demoCard').hidden = true; }
  hostMode = false;
  lastAuto = null;
  stopStream(false);
  stopWalk();
  state.info = {};
  state.pressed.clear();
  renderInfo();
  setConnected(false);
});

link.addEventListener('line', (e) => {
  const line = e.detail;
  if (line.startsWith('KEY ')) onKey(line);
  else if (line.startsWith('LAYER ')) onLayer(line);
  else if (line.startsWith('INFO')) {
    state.info = parseInfo(line);
    if (stats) stats.onInfo(state.info);
    updateTray();
    if (state.info.layer !== undefined && +state.info.layer >= 0) setActiveLayer(+state.info.layer);
    renderInfo();
  }
  logLine(line, line.startsWith('ERR') ? 'err' : line.startsWith('KEY') || line.startsWith('LAYER') ? 'ev' : '');
});
link.addEventListener('tx', (e) => logLine('→ ' + e.detail, 'tx'));

async function connect() {
  try {
    await link.connect();
  } catch (e) {
    if (/No port selected|cancel/i.test(e.message)) return;
    if (/Failed to open/i.test(e.message)) toast('Порт занят другой программой (Arduino IDE, PuTTY, второй Corne Studio?) — закройте её и попробуйте снова.', true);
    else toast('Не удалось подключиться: ' + e.message, true);
  }
}

cs.serial.onPorts(async (ports) => {
  const isZmk = (p) => /^(0x)?(1d50|7504)$/i.test(String(p.vendorId || ''));
  const zmk = ports.filter(isZmk);
  if (zmk.length === 1) return cs.serial.choose(zmk[0].portId);
  if (!ports.length) {
    toast('COM-портов нет. Подключите главную половину по USB (прошивка с модулем corne-tool) или нажмите «Демо».', true);
    return cs.serial.choose('');
  }
  // Показываем все порты: клавиатура может прийти без USB VID
  const list = (zmk.length ? zmk : ports).map((p) => ({
    label: (isZmk(p) ? '⌨ ' : '') + (p.displayName || p.portName),
    sub: p.portName,
    value: p.portId,
  }));
  const id = await pick('Выберите порт клавиатуры (обычно «Устройство с последовательным интерфейсом USB»)', list);
  cs.serial.choose(id || '');
});

async function autoConnect() {
  try {
    const ports = await navigator.serial.getPorts();
    const p = ports.find((x) => x.getInfo().usbVendorId === 0x1d50) || (ports.length === 1 ? ports[0] : null);
    if (p && !link.connected) await link.open(p);
  } catch { /* порт занят или нет */ }
}

navigator.serial.addEventListener('connect', () => setTimeout(autoConnect, 800));

/* ================= события клавиш ================= */

function onKey(line) {
  const [, p, s] = line.split(' ');
  const pos = +p, down = s === '1';
  const now = performance.now() / 1000;
  const k = KEYS[pos];
  if (!k) return;
  if (down) {
    lastKeyTime = performance.now();
    // Дребезг: повторное срабатывание той же клавиши почти сразу после отпускания
    if (lastRelease[pos] && performance.now() - lastRelease[pos] < 30) {
      bounces[pos] = (bounces[pos] || 0) + 1;
      kbs.debug.setClass(pos, 'bounce', true);
      const total = Object.values(bounces).reduce((a, b) => a + b, 0);
      $('#keysBounce').textContent = `⚠ дребезг: ${total}`;
      keysLog(`${new Date().toLocaleTimeString()}  ⚠ ДРЕБЕЗГ клавиши ${pos} (${Math.round(performance.now() - lastRelease[pos])} мс после отпускания)`);
    }
    if (stats) stats.onPress(pos);
    if (games) games.onKey(pos, true);
    if (tools) { tools.petFeed(); tools.onKeyBinding(resolveBinding(pos)); }
    state.pressed.add(pos);
    state.presses.push({ pos, x: k.cx / 100, y: k.cy / 100, t: now });
    if (state.presses.length > 40) state.presses.shift();
    state.counts[pos] = (state.counts[pos] || 0) + 1;
    state.tested.add(pos);
    kbs.debug.setClass(pos, 'tested', true);
    kbs.debug.setIndex(pos, String(state.counts[pos]));
    $('#keysTested').textContent = `${state.tested.size} / 42 проверено`;
    keysLog(`${new Date().toLocaleTimeString()}  клавиша ${pos} (${k.half === 'L' ? 'левая' : 'правая'})  ↓`);
    pressCount++;
  } else {
    state.pressed.delete(pos);
    lastRelease[pos] = performance.now();
  }
  for (const kb of [kbs.overview, kbs.layers, kbs.debug, kbs.light]) kb.setClass(pos, 'pressed', down);
  if (isModifierBinding(getLayers()[0].bindings[pos])) updateHints();
}

function onLayer(line) {
  const [, l, s] = line.split(' ');
  if (s === '1') state.activeLayers.add(+l);
  else state.activeLayers.delete(+l);
  const before = state.layer;
  setActiveLayer(Math.max(0, ...state.activeLayers));
  if (designer && state.layer !== before) designer.trigger('layer');
}

function setActiveLayer(l) {
  if (l === state.layer) return;
  state.layer = l;
  applyLabels(kbs.overview, l);
  applyLabels(kbs.debug, l);
  renderLayerTabs();
}

function keysLog(text) {
  const el = $('#keysLog');
  el.textContent = (text + '\n' + el.textContent).slice(0, 4000);
}

/* ================= консоль ================= */

function logLine(text, cls = '') {
  if (!$('#conFrames').checked && text.startsWith('→ LED FRAME')) return;
  const el = $('#conLog');
  const span = document.createElement('div');
  span.className = cls;
  span.textContent = text;
  el.appendChild(span);
  while (el.childNodes.length > 500) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

/* ================= слои ================= */

function renderLayerTabs() {
  const box = $('#layerTabs');
  box.innerHTML = '';
  const km = state.keymap;
  if (!km) return;
  km.model.layers.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === km.cur ? ' primary' : '') + (i === state.layer && link.connected ? ' cur' : '');
    b.textContent = `${i}: ${l.name}`;
    b.title = i === state.layer && link.connected ? 'Сейчас активен на клавиатуре' : '';
    b.onclick = () => { km.cur = i; km.sel = null; renderLayers(); };
    box.appendChild(b);
  });
}

function renderLayers() {
  const km = state.keymap;
  renderLayerTabs();
  applyLabels(kbs.layers, km ? km.cur : 0);
  kbs.layers.clearClass('selected');
  if (km && km.sel !== null) kbs.layers.setClass(km.sel, 'selected', true);
  $('#kmEditor').hidden = !km;
  $('#picker').hidden = !km;
  if (picker) picker.redraw();
  if (km) {
    $('#kmLayerName').value = km.model.layers[km.cur].name;
    $('#kmPath').textContent = (km.path || 'новый файл') + (km.dirty ? ' • изменён' : '');
  }
  applyLabels(kbs.overview, state.layer);
  applyLabels(kbs.debug, state.layer);
}

function selectKeymapKey(pos) {
  const km = state.keymap;
  if (!km) return toast('Сначала откройте corne.keymap');
  km.sel = pos;
  $('#kmPos').textContent = `${pos} (${KEYS[pos].half === 'L' ? 'левая' : 'правая'})`;
  $('#kmBinding').value = km.model.layers[km.cur].bindings[pos] || '';
  $('#kmBinding').focus();
  renderLayers();
}

function applyBinding() {
  const km = state.keymap;
  if (!km || km.sel === null) return;
  let v = $('#kmBinding').value.trim().replace(/\s+/g, ' ');
  if (!v.startsWith('&')) v = '&' + v;
  km.model.layers[km.cur].bindings[km.sel] = v;
  km.dirty = true;
  renderLayers();
}

async function saveKeymap(asNew, quiet = false) {
  const km = state.keymap;
  if (!km) return;
  const text = ensureIncludes(serializeKeymap(km.model));
  const p = await cs.keymap.save(asNew ? null : km.path, text);
  if (!p) return;
  km.model = parseKeymap(text);
  km.path = p;
  km.dirty = false;
  renderLayers();
  if (!quiet) toast(settings.repoDir ? 'Сохранено. Нажмите «Собрать и прошить» на вкладке «Прошивка».' : 'Сохранено. Закоммитьте файл и прошейте новую сборку.');
}

/* ================= подсветка ================= */

const leds = buildLeds();
let light = { id: 'b:rainbow', params: { ...DEFAULT_PARAMS } };
let renderFn = null;
let streaming = false;
let frames = 0;

function effectOf(id) {
  if (id.startsWith('c:')) {
    const m = (settings.customModes || [])[+id.slice(2)];
    return m ? m.effect : 'solid';
  }
  return id.slice(2);
}

function fillEffectSelect() {
  const sel = $('#effSelect');
  sel.innerHTML = '';
  const g1 = document.createElement('optgroup');
  g1.label = 'Эффекты';
  for (const [id, e] of Object.entries(EFFECTS)) g1.append(new Option(e.name + (e.reactive ? ' ⚡' : ''), 'b:' + id));
  sel.append(g1);
  const modes = settings.customModes || [];
  if (modes.length) {
    const g2 = document.createElement('optgroup');
    g2.label = 'Мои режимы';
    modes.forEach((m, i) => g2.append(new Option(m.name, 'c:' + i)));
    sel.append(g2);
  }
  sel.value = light.id;
  if (sel.value !== light.id) { light.id = 'b:rainbow'; sel.value = light.id; }
}

function syncParamsUI() {
  const eff = effectOf(light.id);
  const p = light.params;
  const used = new Set(EFFECTS[eff].params);
  $$('[data-param]').forEach((l) => { l.hidden = !used.has(l.dataset.param); });
  $('#pColor1').value = p.color1;
  $('#pColor2').value = p.color2;
  $('#pSpeed').value = p.speed;
  $('#pSize').value = p.size;
  $('#pBright').value = p.brightness;
  $('#pCode').hidden = eff !== 'code';
  $('#pCode').value = p.code;
  $('#effDelete').hidden = !light.id.startsWith('c:');
  $('#audioRow').hidden = !EFFECTS[eff].audio;
  rebuildRenderer();
}

function rebuildRenderer() {
  try {
    renderFn = makeRenderer(effectOf(light.id), light.params);
  } catch (e) {
    toast('Ошибка в коде эффекта: ' + e.message, true);
    renderFn = makeRenderer('solid', { ...light.params, color1: '#ff0000' });
  }
  saveSettings({ light });
}

function readParams() {
  Object.assign(light.params, {
    color1: $('#pColor1').value,
    color2: $('#pColor2').value,
    speed: +$('#pSpeed').value,
    size: +$('#pSize').value,
    brightness: +$('#pBright').value,
    code: $('#pCode').value,
  });
  if (light.id.startsWith('c:')) {
    const m = settings.customModes[+light.id.slice(2)];
    if (m) { m.params = { ...light.params }; saveSettings({ customModes: settings.customModes }); }
  }
  rebuildRenderer();
}

/* ---- Компоновщик подсветки: свой режим + наложения (подсказки, тренажёр, Claude, уведомления) ---- */
const overlays = new Map(); // id → { fn(led, t, base) → [r,g,b] | null, until, prio }
let hostMode = false;
let hostPending = false;
let streamT0 = 0;

function setOverlay(id, fn, { ms = 0, prio = 1 } = {}) {
  overlays.set(id, { fn, prio, until: ms ? performance.now() + ms : 0 });
}
function clearOverlay(id) { overlays.delete(id); }

function computeFrame(forDevice = false) {
  const t = performance.now() / 1000;
  const ctx = { presses: state.presses, pressed: state.pressed, layer: state.layer, audio };
  const now = performance.now();
  for (const [id, o] of overlays) if (o.until && now > o.until) overlays.delete(id);
  const list = [...overlays.values()].sort((a, b) => a.prio - b.prio);
  const baseOn = !forDevice || streaming;
  return leds.map((l) => {
    let c = baseOn ? renderFn(l, t, ctx) : [0, 0, 0];
    for (const o of list) {
      const v = o.fn(l, t, c);
      if (v) c = v;
    }
    return c;
  });
}

function previewLoop() {
  if (currentTab === 'lighting' && renderFn) {
    const colors = computeFrame();
    leds.forEach((l, i) => {
      const c = colors[i];
      const css = `rgb(${c.map((v) => Math.max(0, Math.min(255, v * 1.6 + 10)) | 0).join(',')})`;
      kbs.light.setLed(l.half, l.index, css);
      if (l.pos !== null) kbs.light.setKeyColor(l.pos, `rgb(${c.map((v) => Math.min(255, v * 1.4) | 0).join(',')})`);
    });
  }
  requestAnimationFrame(previewLoop);
}

// Один таймер на всё: включает ручной режим, когда есть что показывать, и отдаёт подсветку прошивке, когда нечего
setInterval(async () => {
  const want = link.connected && (streaming || overlays.size > 0) && currentTab !== 'debug' && !walkTimer;
  if (!want) {
    if (hostMode) {
      hostMode = false;
      if (link.connected && currentTab !== 'debug') link.write('LED FW');
    }
    return;
  }
  if (!hostMode) {
    if (hostPending) return;
    hostPending = true;
    try { await link.request('LED HOST'); hostMode = true; streamT0 = performance.now(); frames = 0; } catch { /* нет ответа */ }
    hostPending = false;
    return;
  }
  const colors = computeFrame(true);
  const frame = new Array(LEDS_PER_HALF).fill('000000');
  const h = MH();
  const cal = (tools && tools.calib) || { r: 1, g: 1, b: 1 };
  leds.forEach((l, i) => {
    if (l.half === h) {
      const [r, g, b] = colors[i];
      frame[l.index] = rgbToHex([r * cal.r, g * cal.g, b * cal.b]);
    }
  });
  link.sendFrame(frame.join(''));
  frames++;
  if (streaming && frames % 30 === 0) $('#streamStat').textContent = `${Math.round(frames / ((performance.now() - streamT0) / 1000))} кадр/с`;
}, 33);

async function startStream() {
  if (!requireLink()) return;
  streaming = true;
  $('#streamBtn').textContent = '■ Остановить';
  $('#streamBtn').classList.remove('primary');
}

function stopStream(sendFw = true) {
  if (!streaming) return;
  streaming = false;
  $('#streamBtn').textContent = '▶ Включить на клавиатуре';
  $('#streamBtn').classList.add('primary');
  $('#streamStat').textContent = '';
  if (!sendFw) hostMode = false; // команда дебага сама управляет подсветкой
}

/** Короткая вспышка цветом — для уведомлений */
function flashNotify(hex, ms = 1500) {
  const c = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  setOverlay('notify', (led, t) => {
    const k = 0.5 + 0.5 * Math.sin(t * 12);
    return c.map((v) => v * (0.25 + 0.6 * k));
  }, { ms, prio: 9 });
}

async function saveMode() {
  const name = await pick('Название режима', [], { input: EFFECTS[effectOf(light.id)].name });
  if (!name) return;
  const modes = settings.customModes || [];
  modes.push({ name, effect: effectOf(light.id), params: { ...light.params } });
  await saveSettings({ customModes: modes });
  light.id = 'c:' + (modes.length - 1);
  fillEffectSelect();
  syncParamsUI();
  toast(`Режим «${name}» сохранён`);
}

async function deleteMode() {
  if (!light.id.startsWith('c:')) return;
  const modes = settings.customModes || [];
  modes.splice(+light.id.slice(2), 1);
  await saveSettings({ customModes: modes });
  light.id = 'b:rainbow';
  fillEffectSelect();
  syncParamsUI();
}

async function rgbCmd(c) {
  stopStream();
  return cmd(`RGB ${c}`);
}

function hsbSwatch() {
  const [r, g, b] = hsv(+$('#hsbH').value, $('#hsbS').value / 100, Math.max(0.25, $('#hsbB').value / 100));
  $('#hsbSwatch').style.background = `rgb(${r | 0},${g | 0},${b | 0})`;
}

/* ================= экран ================= */

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function translit(s) {
  return [...s].map((ch) => {
    const lo = ch.toLowerCase();
    if (TR[lo] === undefined) return /[\x20-\x7e]/.test(ch) ? ch : '?';
    const t = TR[lo];
    return ch !== lo && t ? t[0].toUpperCase() + t.slice(1) : t;
  }).join('');
}

let screenLive = false;
let lastAuto = null;
let screenTimer = null;
let pressCount = 0;

async function screenLines() {
  const mode = $('#scrMode').value;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (mode === 'clock') {
    return ['', `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, now.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })];
  }
  if (mode === 'sys') {
    const s = await cs.sysStats();
    const bar = (v) => '|'.repeat(Math.round(v / 10)).padEnd(10, '.');
    return ['', `CPU ${String(s.cpu).padStart(3)}% ${bar(s.cpu)}`, `RAM ${String(s.ram).padStart(3)}% ${bar(s.ram)}`];
  }
  const toolLines = tools && tools.screenLines(mode);
  if (toolLines) return toolLines;
  if (mode === 'claude') {
    const words = { working: 'думает...', waiting: 'ждёт ответа!', done: 'готово', idle: 'свободен' };
    return ['', `Claude: ${words[claudeState.state] || 'свободен'}`, claudeState.at ? `с ${claudeState.at}` : ''];
  }
  if (mode === 'keys') {
    return ['', `Нажатий: ${pressCount}`, `Клавиш проверено: ${state.tested.size}/42`];
  }
  return [$('#scrL0').value, $('#scrL1').value, $('#scrL2').value];
}

async function sendScreen() {
  if (!link.connected) return;
  const auto = $('#scrAuto').checked;
  const lines = (await screenLines()).map(translit);
  if (auto !== lastAuto) { await link.write(`DISP AUTO ${auto ? 1 : 0}`); lastAuto = auto; }
  for (let i = auto ? 1 : 0; i < 3; i++) await link.write(`DISP LINE ${i} ${lines[i]}`);
  drawOled(lines);
}

function drawOled(lines) {
  const c = $('#oled').getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, 128, 32);
  c.fillStyle = '#9fd4ff';
  c.font = '8px "Segoe UI", sans-serif';
  c.textBaseline = 'top';
  const auto = $('#scrAuto').checked;
  const i = state.info;
  const status = `${i.layer_name && i.layer_name !== '-' ? i.layer_name : 'L' + (i.layer ?? 0)}  BT${(+(i.profile ?? 0)) + 1}  ${i.bat ?? '--'}%`;
  (lines || ['', '', '']).forEach((l, n) => c.fillText(n === 0 && auto ? status : translit(l || ''), 0, n * 10 + 1));
}

async function updateScreenPreview() {
  drawOled(await screenLines());
}

/* ================= прошивка ================= */

let fwFiles = [];

function flashStep(text, cls = 'wait') {
  const d = document.createElement('div');
  d.className = 'step ' + cls;
  d.textContent = text;
  $('#flashLog').appendChild(d);
  return d;
}

function fileFor(role, set = settings.mainSide || 'left') {
  if (role !== 'reset' && fwFiles.some((x) => /^main-(left|right)_/.test(x.name))) {
    return fwFiles.find((x) => x.name.startsWith(`main-${set}_corne_${role}`)) || null;
  }
  const re = { left: /left/i, right: /right/i, reset: /settings_reset/i }[role];
  const f = fwFiles.find((x) => re.test(x.name));
  if (f) return f;
  if (role !== 'reset' && fwFiles.length === 1 && !/settings_reset/i.test(fwFiles[0].name)) return fwFiles[0];
  return null;
}

/** Что реально делает клавиша сейчас: верхний активный слой, &trans — смотрим ниже */
function resolveBinding(pos) {
  const layers = getLayers();
  const active = [...state.activeLayers].sort((a, b) => b - a);
  for (const l of active) {
    const b = layers[l] && layers[l].bindings[pos];
    if (b && b !== '&trans') return b;
  }
  return layers[0].bindings[pos];
}

/** Значения подстановок для конструктора экрана */
function screenVars() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const i = state.info;
  const claudeWords = { working: 'думает…', waiting: 'ждёт ответа', done: 'готово', idle: 'свободен' };
  const tl = tools ? tools.screenLines('pomodoro') : null;
  const pet = tools ? tools.screenLines('pet') : null;
  const w = tools ? tools.screenLines('weather') : null;
  const days = stats ? (settings.stats || { days: {} }) : null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    sec: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    date: now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    day: now.toLocaleDateString('ru-RU', { weekday: 'long' }),
    bat: i.bat ?? '--',
    layer: i.layer_name && i.layer_name !== '-' ? i.layer_name : `L${state.layer}`,
    bt: +(i.profile ?? 0) + 1,
    wpm: stats ? stats.wpm() : 0,
    presses: days && days.days && days.days[today] ? days.days[today].presses : 0,
    cpu: sysCache.cpu, ram: sysCache.ram,
    weather: w && w[1] ? w[1].replace(/^\S+\s*/, '') : '',
    temp: w && w[1] ? (w[1].match(/^[+-]?\d+C/) || [''])[0].replace('C', '°') : '',
    claude: claudeWords[claudeState.state] || 'свободен',
    pomodoro: tl ? tl[1] : '',
    pet: pet ? pet[0] : '',
    profile: $('#profNow') ? $('#profNow').textContent : '',
    layernum: state.layer,
    app: activeProc || '—',
    hour: pad(now.getHours()), min: pad(now.getMinutes()),
    year: now.getFullYear(), month: now.toLocaleDateString('ru-RU', { month: 'long' }),
    uptime: sysCache.uptime ? `${Math.floor(sysCache.uptime / 3600)} ч ${Math.floor((sysCache.uptime % 3600) / 60)} мин` : '',
    _pressed: state.pressed,
    _keys: KEYS,
    _audio: audio,
  };
}

/* ================= подсказки горячих клавиш ================= */

function currentHotkeySet() {
  return hotkeyPref === 'auto' ? setForProcess(allSets(settings.customHotkeys), activeProc) : hotkeyPref;
}

function updateHints() {
  const sets = allSets(settings.customHotkeys);
  const id = currentHotkeySet();
  const set = sets[id] || sets.windows;
  $('#hkSetTag').textContent = set.name;
  const layer0 = getLayers()[0].bindings;
  const combo = heldCombo(state.pressed, layer0);
  const entries = combo ? (set.combos || {})[combo] || {} : {};
  const names = Object.keys(entries);
  if (!combo || !names.length) {
    clearOverlay('hints');
    $('#hintPanel').classList.add('hidden');
    $('#hkList').innerHTML = `<span class="muted">${combo ? `Для ${combo} в наборе «${set.name}» ничего нет` : 'Зажмите модификатор…'}</span>`;
    KEYS.forEach((k) => kbs.overview.setKeyColor(k.pos, ''));
    return;
  }
  const hintPos = new Set();
  for (const n of names) {
    const p = layer0.indexOf(`&kp ${n}`);
    if (p >= 0) hintPos.add(p);
  }
  const modPos = new Set([...state.pressed].filter((p) => isModifierBinding(layer0[p])));
  const html = names.map((n) => `<div class="hk"><b>${n}</b>${entries[n]}</div>`).join('');
  $('#hkList').innerHTML = html;
  $('#hintPanel').innerHTML = `<h3>${combo} · ${set.name}</h3><div class="hk-list">${html}</div>`;
  $('#hintPanel').classList.toggle('hidden', currentTab === 'overview');
  KEYS.forEach((k) => kbs.overview.setKeyColor(k.pos, hintPos.has(k.pos) ? 'rgba(91,227,176,.8)' : ''));
  if (!$('#hkOn').checked) return clearOverlay('hints');
  setOverlay('hints', (led) => {
    if (led.pos !== null && hintPos.has(led.pos)) return [0, 200, 160];
    if (led.pos !== null && modPos.has(led.pos)) return [200, 200, 200];
    return led.under ? [0, 10, 8] : [0, 0, 0];
  }, { prio: 6 });
}

/* ================= статус Claude ================= */

const claudeState = { state: 'idle', at: '' };

function setClaude(st) {
  claudeState.state = st.state;
  claudeState.at = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const names = { working: 'думает', waiting: 'ждёт ответа', done: 'готово', idle: 'свободен' };
  $('#claudeTag').textContent = names[st.state] || st.state;
  if (st.state === 'working') {
    setOverlay('claude', (led, t, base) => (led.under ? [20, 60, 255].map((v) => v * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2)))) : base), { prio: 2 });
  } else if (st.state === 'waiting') {
    if (designer) designer.trigger('claude_waiting');
    setOverlay('claude', (led, t, base) => (led.under ? (Math.sin(t * 8) > 0 ? [255, 120, 0] : [30, 10, 0]) : base), { prio: 2 });
  } else if (st.state === 'done') {
    if (designer) designer.trigger('claude_done');
    setOverlay('claude', (led, t, base) => (led.under ? [0, 255, 90] : base), { prio: 2, ms: 2500 });
  } else {
    clearOverlay('claude');
  }
  if (screenLive && $('#scrMode').value === 'claude') sendScreen();
}

/* ================= профили: применение ================= */

function effectOptions() {
  return [
    ...Object.entries(EFFECTS).filter(([id]) => id !== 'code').map(([id, e]) => ['b:' + id, e.name]),
    ...(settings.customModes || []).map((m, i) => ['c:' + i, '★ ' + m.name]),
  ];
}

function applyLight(spec) {
  if (spec === 'off' || spec === 'zmk') {
    stopStream();
    if (link.connected) link.write(`RGB ${spec === 'off' ? 'OFF' : 'ON'}`);
    return;
  }
  light.id = spec;
  if (spec.startsWith('c:')) {
    const m = (settings.customModes || [])[+spec.slice(2)];
    if (m) light.params = { ...DEFAULT_PARAMS, ...m.params };
  }
  fillEffectSelect();
  syncParamsUI();
  if (link.connected) startStream();
}

function applyScreen(mode, lines) {
  $('#scrMode').value = mode;
  if (mode === 'text') ['#scrL0', '#scrL1', '#scrL2'].forEach((s, i) => { $(s).value = lines[i] || ''; });
  updateScreenPreview();
  if (link.connected) { quietScreen = true; $('#scrSend').click(); quietScreen = false; }
}
let quietScreen = false;

function setHotkeySet(id) {
  hotkeyPref = id || 'auto';
  updateHints();
}

/* ================= PDF-шпаргалка ================= */

async function exportPdf() {
  const layers = getLayers();
  const tmp = document.createElement('div');
  tmp.style.cssText = 'position:absolute;left:-9999px;width:1400px';
  document.body.appendChild(tmp);
  const pages = layers.map((l, i) => {
    const kb = renderKeyboard(tmp, { showLeds: false });
    const labels = l.bindings.map((b) => keyLabel(b, layers));
    KEYS.forEach((k) => kb.setLabel(k.pos, labels[k.pos] === '▽' ? '' : labels[k.pos] || ''));
    return `<section><h2>${i}: ${l.name}</h2>${kb.svg.outerHTML}</section>`;
  });
  tmp.remove();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:"Segoe UI",sans-serif;margin:0;color:#111}
    h1{font-size:18px;margin:0 0 6px} h2{font-size:15px;margin:10px 0 2px}
    section{page-break-inside:avoid} svg{width:100%;height:auto}
    .key rect{fill:#fff;stroke:#333;stroke-width:2} .key rect.glow{display:none}
    .key text{fill:#111;font-family:"Segoe UI",sans-serif} .key text.idx{display:none}
  </style></head><body><h1>Corne — шпаргалка слоёв</h1>${pages.join('')}</body></html>`;
  const p = await cs.savePdf(html);
  if (p) toast('Шпаргалка сохранена');
}

function setFirmwareFiles(files) {
  fwFiles = files;
  renderFwFiles();
}

function updateTray() {
  const i = state.info;
  if (!link.connected) return cs.tray.status('Corne Studio — не подключено');
  const parts = [i.bat >= 0 ? `🔋 ${i.bat}%` : null, i.layer_name && i.layer_name !== '-' ? i.layer_name : null].filter(Boolean);
  cs.tray.status(`Corne · ${parts.join(' · ') || 'подключено'}`);
}

function loadKeymapText(f) {
  state.keymap = { model: parseKeymap(f.text), path: f.path, cur: 0, sel: null, dirty: false };
  $('#kmSave').disabled = $('#kmSaveAs').disabled = false;
  renderLayers();
  toast(`Слоёв: ${state.keymap.model.layers.length}`);
}

function renderFwFiles() {
  const box = $('#fwFiles');
  box.innerHTML = '';
  if (!fwFiles.length) box.innerHTML = '<p class="muted">Файлы прошивки ещё не выбраны.</p>';
  for (const f of fwFiles) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = '<span class="dot ok"></span><span class="grow mono"></span><span class="muted"></span>';
    d.children[1].textContent = f.name;
    d.children[2].textContent = `${Math.round(f.data.length / 1024)} КБ`;
    box.appendChild(d);
  }
  $('#flashLeft').disabled = !fileFor('left');
  $('#flashRight').disabled = !fileFor('right');
  $('#switchMain').disabled = !fwFiles.some((x) => /^main-(left|right)_/.test(x.name));
  const ms = settings.mainSide || 'left';
  $('#flashLeft').textContent = `Прошить левую${ms === 'left' ? ' (главная)' : ''}`;
  $('#flashRight').textContent = `Прошить правую${ms === 'right' ? ' (главная)' : ''}`;
  $('#flashReset').disabled = !fileFor('reset');
}

async function loadRuns() {
  const repo = $('#ghRepo').value.trim();
  if (!repo) return toast('Укажите репозиторий, например yakory777/corne-studio', true);
  saveSettings({ repo });
  const box = $('#runs');
  box.innerHTML = '<p class="muted">Загрузка…</p>';
  try {
    const runs = await cs.gh.runs(repo);
    box.innerHTML = '';
    if (!runs.length) box.innerHTML = '<p class="muted">Сборок нет.</p>';
    for (const r of runs) {
      const d = document.createElement('div');
      d.className = 'item';
      const st = r.status !== 'completed' ? 'run' : r.conclusion === 'success' ? 'ok' : 'fail';
      d.innerHTML = `<span class="dot ${st}"></span><span class="grow"></span><span class="muted mono"></span>`;
      d.children[1].textContent = r.title;
      d.children[2].textContent = `${r.sha} · ${new Date(r.created).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
      d.title = st === 'ok' ? 'Скачать прошивку из этой сборки' : st === 'run' ? 'Сборка ещё идёт' : 'Сборка упала — откройте её на GitHub';
      d.onclick = async () => {
        if (st === 'fail') return cs.openUrl(`https://github.com/${repo}/actions/runs/${r.id}`);
        if (st === 'run') return toast('Сборка ещё не закончилась');
        $$('#runs .item').forEach((x) => x.classList.remove('sel'));
        d.classList.add('sel');
        toast('Скачиваю прошивку…');
        try {
          fwFiles = await cs.gh.download(repo, r.id);
          renderFwFiles();
          toast(`Скачано файлов: ${fwFiles.length}`);
        } catch (e) { toast(e.message, true); }
      };
      box.appendChild(d);
    }
  } catch (e) {
    box.innerHTML = '';
    toast(e.message, true);
  }
}

async function waitForDrive(timeoutMs, ignore = []) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const drives = (await cs.fw.drives()).filter((d) => !ignore.includes(d.root));
    if (drives.length) return drives[0];
    await sleep(500);
  }
  return null;
}

let flashing = false;

async function flash(role, half, { set, keepLog = false } = {}) {
  if (flashing) return false;
  const file = fileFor(role, set);
  if (!file) { toast('Нет подходящего файла прошивки', true); return false; }
  half = half || role;
  flashing = true;
  if (!keepLog) $('#flashLog').innerHTML = '';
  const halfName = sideName(half, 'вин');
  let ok = false;
  try {
    flashStep(`Файл: ${file.name}`, 'ok');
    let drive = (await cs.fw.drives())[0];
    if (!drive) {
      if (link.connected && (state.info.side || 'left') === half) {
        stopStream(false);
        flashStep(`Перевожу ${halfName} половину в режим прошивки по USB…`, 'ok');
        await link.write('BOOT');
      } else {
        flashStep(`Подключите ${halfName} половину по USB и переведите в режим прошивки: ` +
          (half === 'right' ? 'Lower + Esc на клавиатуре, или дважды reset.' : 'Raise + левый Shift, или дважды reset.'));
      }
      const w = flashStep('Жду диск NICENANO (до 90 секунд)…');
      drive = await waitForDrive(90000);
      if (!drive) { w.className = 'step err'; w.textContent = 'Диск не появился. Попробуйте дважды reset и нажмите «Прошить» снова.'; return; }
      w.className = 'step ok';
      w.textContent = `Найден диск ${drive.root} ${drive.model ? '(' + drive.model + ')' : ''}`;
    } else {
      const yes = await pick(`Диск ${drive.root} уже в режиме прошивки. Это ${halfName} половина?`, [
        { label: `Да, это ${halfName}`, value: true },
        { label: 'Нет, отмена', value: false },
      ]);
      if (!yes) { flashStep('Отменено. Отключите лишнюю половину и начните заново.', 'err'); return; }
      flashStep(`Диск уже подключён: ${drive.root} ${drive.model ? '(' + drive.model + ')' : ''}`, 'ok');
    }
    const s = flashStep('Записываю прошивку…');
    const r = await cs.fw.write(drive.root, file.data);
    if (!r.ok) { s.className = 'step err'; s.textContent = 'Ошибка записи: ' + r.note; return; }
    s.className = 'step ok';
    s.textContent = 'Записано' + (r.note ? ` (${r.note})` : '');
    const end = Date.now() + 15000;
    while (Date.now() < end && (await cs.fw.drives()).some((d) => d.root === drive.root)) await sleep(400);
    flashStep(role === 'reset'
      ? `Настройки ${sideName(half, 'род')} половины сброшены.`
      : `Готово! ${sideName(half).replace(/^./, (c) => c.toUpperCase())} половина перезагрузилась с новой прошивкой.`, 'ok');
    setTimeout(autoConnect, 2500);
    ok = true;
  } catch (e) {
    flashStep('Ошибка: ' + e.message, 'err');
  } finally {
    flashing = false;
  }
  return ok;
}

/** Мастер смены главной половины: сброс обеих, прошивка нового комплекта. */
async function switchMain() {
  const cur = settings.mainSide || 'left';
  const next = cur === 'left' ? 'right' : 'left';
  const other = cur;
  if (!fileFor(next, next) || !fileFor(other, next) || !fileFor('reset')) {
    return toast('В выбранной сборке нет нужных файлов. Обновите build.yaml (комплекты main-left/main-right) и скачайте новую сборку.', true);
  }
  const go = await pick(`Сделать главной ${sideName(next, 'вин')} половину?`, [
    { label: 'Да, начать', sub: '4 шага, ~3 минуты', value: true },
    { label: 'Отмена', value: false },
  ]);
  if (!go) return;
  $('#flashLog').innerHTML = '';
  flashStep('Шаг 1 из 4 — сброс настроек левой половины', 'ok');
  if (!(await flash('reset', 'left', { keepLog: true }))) return;
  if (!(await pick('Отключите левую, подключите правую половину по USB', [{ label: 'Готово, дальше', value: true }, { label: 'Отмена', value: false }]))) return;
  flashStep('Шаг 2 из 4 — сброс настроек правой половины', 'ok');
  if (!(await flash('reset', 'right', { keepLog: true }))) return;
  flashStep(`Шаг 3 из 4 — главная прошивка на ${sideName(next, 'вин')} половину`, 'ok');
  if (next === 'left' && !(await pick('Подключите левую половину по USB', [{ label: 'Готово, дальше', value: true }, { label: 'Отмена', value: false }]))) return;
  if (!(await flash(next, next, { set: next, keepLog: true }))) return;
  if (!(await pick(`Подключите ${sideName(other, 'вин')} половину по USB`, [{ label: 'Готово, дальше', value: true }, { label: 'Отмена', value: false }]))) return;
  flashStep(`Шаг 4 из 4 — прошивка на ${sideName(other, 'вин')} половину`, 'ok');
  if (!(await flash(other, other, { set: next, keepLog: true }))) return;
  await saveSettings({ mainSide: next });
  $('#mainSide').value = next;
  renderFwFiles();
  flashStep(`Готово! Главная теперь ${sideName(next)}. Включите обе половины одновременно — они соединятся сами. ` +
    'В Windows удалите старое устройство «Corne» в настройках Bluetooth и подключите заново. ' +
    `К приложению теперь подключайте ${sideName(next, 'вин')} половину.`, 'ok');
}

/* ================= дебаг: светодиоды и экран ================= */

let walkTimer = null;

function onLedIdx() {
  const i = +$('#ledIdx').value;
  $('#ledIdxLbl').textContent = i < 6 ? `${i} (снизу)` : String(i);
  kbs.leds.clearClass('selected');
  const h = MH();
  KEYS.forEach((k) => { if (k.half === h && DEFAULT_LED_MAP[k.pos] === i) kbs.leds.setClass(k.pos, 'selected', true); });
  leds.forEach((l) => kbs.leds.setLed(l.half, l.index, l.half === h && l.index === i ? $('#ledColor').value : ''));
}

function ledShowOne() {
  if (!link.connected) return;
  stopStream(false);
  const i = +$('#ledIdx').value;
  const frame = new Array(LEDS_PER_HALF).fill('000000');
  frame[i] = $('#ledColor').value.slice(1);
  link.write(`LED FRAME ${frame.join('')}`);
}

function stopWalk() {
  clearInterval(walkTimer);
  walkTimer = null;
  $('#ledWalk').textContent = '▶ Бегущий тест';
}

function toggleWalk() {
  if (walkTimer) return stopWalk();
  if (!requireLink()) return;
  stopStream(false);
  $('#ledWalk').textContent = '■ Стоп';
  walkTimer = setInterval(() => {
    const el = $('#ledIdx');
    el.value = (+el.value + 1) % LEDS_PER_HALF;
    onLedIdx();
    ledShowOne();
  }, Math.max(50, +$('#ledWalkMs').value || 400));
  ledShowOne();
}

/* ================= инициализация ================= */

async function init() {
  // Навигация — первой, чтобы вкладки работали, даже если дальше что-то сломается
  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('.sub').forEach((b) => b.addEventListener('click', () => {
    $$('.sub').forEach((x) => x.classList.toggle('active', x === b));
    $$('.subtab').forEach((x) => x.classList.toggle('active', x.id === `sub-${b.dataset.sub}`));
  }));

  settings = await cs.store.get();
  if (settings.light) light = { id: settings.light.id, params: { ...DEFAULT_PARAMS, ...settings.light.params } };

  initKeyboards();

  // Соединение
  $('#connectBtn').onclick = () => (link.connected ? link.disconnect() : connect());
  $('#demoBtn').onclick = startDemo;

  // Слои
  $('#kmOpen').onclick = async () => {
    const f = await cs.keymap.open();
    if (!f) return;
    try { loadKeymapText(f); } catch (e) { toast('Не удалось разобрать файл: ' + e.message, true); }
  };
  const openFromRepo = async () => {
    const p = settings.repoDir && (await cs.repo.keymapPath(settings.repoDir));
    if (!p) return toast('В папке репозитория нет config/corne.keymap', true);
    try { loadKeymapText(await cs.keymap.read(p)); } catch (e) { toast('Не удалось разобрать файл: ' + e.message, true); }
  };
  $('#kmFromRepo').hidden = !settings.repoDir;
  $('#kmFromRepo').onclick = openFromRepo;
  picker = renderPicker($('#picker'), {
    getLayers: () => (state.keymap ? state.keymap.model.layers : []),
    onPick: (binding) => {
      const km = state.keymap;
      if (!km || km.sel === null) return toast('Сначала кликните клавишу на схеме');
      $('#kmBinding').value = binding;
      applyBinding();
    },
  });
  $('#kmApply').onclick = applyBinding;
  $('#kmBinding').onkeydown = (e) => e.key === 'Enter' && applyBinding();
  $('#kmLayerName').onchange = () => {
    const km = state.keymap;
    if (!km) return;
    km.model.layers[km.cur].name = $('#kmLayerName').value.trim() || km.model.layers[km.cur].node;
    km.dirty = true;
    renderLayers();
  };
  $('#kmSave').onclick = () => saveKeymap(false);
  $('#kmSaveAs').onclick = () => saveKeymap(true);

  // Подсветка
  fillEffectSelect();
  syncParamsUI();
  $('#effSelect').onchange = () => {
    light.id = $('#effSelect').value;
    if (light.id.startsWith('c:')) {
      const m = settings.customModes[+light.id.slice(2)];
      light.params = { ...DEFAULT_PARAMS, ...m.params };
    }
    syncParamsUI();
  };
  ['#pColor1', '#pColor2', '#pSpeed', '#pSize', '#pBright'].forEach((s) => $(s).addEventListener('input', readParams));
  $('#pCode').addEventListener('change', readParams);
  $('#effSave').onclick = saveMode;
  $('#effDelete').onclick = deleteMode;
  $('#streamBtn').onclick = () => (streaming ? stopStream() : startStream());
  $$('[data-rgb]').forEach((b) => (b.onclick = () => rgbCmd(b.dataset.rgb)));
  $$('[data-efs]').forEach((b) => (b.onclick = () => rgbCmd(`EFS ${b.dataset.efs}`)));
  ['#hsbH', '#hsbS', '#hsbB'].forEach((s) => {
    $(s).addEventListener('input', hsbSwatch);
    $(s).addEventListener('change', () => rgbCmd(`HSB ${$('#hsbH').value} ${$('#hsbS').value} ${$('#hsbB').value}`));
  });
  hsbSwatch();
  requestAnimationFrame(previewLoop);

  // Экран
  const scr = settings.screen || {};
  ['#scrL0', '#scrL1', '#scrL2'].forEach((s, i) => { $(s).value = (scr.lines || ['', 'Corne Studio', ''])[i] || ''; });
  $('#scrAuto').checked = scr.auto !== false;
  $('#scrMode').value = scr.mode || 'text';
  const saveScr = () => saveSettings({ screen: { lines: [$('#scrL0').value, $('#scrL1').value, $('#scrL2').value], auto: $('#scrAuto').checked, mode: $('#scrMode').value } });
  ['#scrL0', '#scrL1', '#scrL2', '#scrAuto', '#scrMode'].forEach((s) => $(s).addEventListener('input', () => { saveScr(); updateScreenPreview(); }));
  $('#scrSend').onclick = async () => {
    if (!requireLink()) return;
    if (designer && designer.enabled()) { designer.disable(); await link.write('DISP MODE TEXT'); }
    clearInterval(screenTimer);
    screenLive = $('#scrMode').value !== 'text';
    await sendScreen();
    if (screenLive) screenTimer = setInterval(sendScreen, 1000);
    if (!quietScreen) toast(screenLive ? 'Экран обновляется в реальном времени' : 'Отправлено на экран');
  };
  $('#scrClear').onclick = async () => {
    clearInterval(screenTimer);
    screenLive = false;
    await cmd('DISP CLEAR');
    drawOled(['', '', '']);
  };
  setInterval(() => currentTab === 'screen' && updateScreenPreview(), 1000);
  updateScreenPreview();

  // Прошивка
  $('#ghRepo').value = settings.repo || 'yakory777/corne-studio';
  if (await cs.token.has()) $('#ghToken').placeholder = 'токен сохранён (зашифрован)';
  $('#ghTokenSave').onclick = async () => {
    await cs.token.set($('#ghToken').value.trim());
    $('#ghToken').value = '';
    $('#ghToken').placeholder = (await cs.token.has()) ? 'токен сохранён (зашифрован)' : 'нужен для скачивания артефактов';
    toast('Токен сохранён');
  };
  $('#ghRefresh').onclick = loadRuns;
  $('#fwLocal').onclick = async () => {
    const files = await cs.fw.open();
    if (files.length) { fwFiles = files; renderFwFiles(); }
  };
  $('#mainSide').value = settings.mainSide || 'left';
  $('#mainSide').onchange = async () => { await saveSettings({ mainSide: $('#mainSide').value }); renderFwFiles(); onLedIdx(); };
  $('#switchMain').onclick = switchMain;
  $('#flashLeft').onclick = () => flash('left');
  $('#flashRight').onclick = () => flash('right');
  $('#flashReset').onclick = async () => {
    const half = await pick('settings_reset — на какую половину?', [
      { label: 'Левая', value: 'left' },
      { label: 'Правая', value: 'right' },
    ]);
    if (half) flash('reset', half);
  };

  // Дебаг
  $('#keysReset').onclick = () => {
    state.tested.clear();
    state.counts = {};
    kbs.debug.clearClass('tested');
    KEYS.forEach((k) => kbs.debug.setIndex(k.pos, ''));
    $('#keysTested').textContent = '0 / 42 проверено';
    Object.keys(bounces).forEach((k) => delete bounces[k]);
    kbs.debug.clearClass('bounce');
    $('#keysBounce').textContent = '';
    $('#keysLog').textContent = '';
  };
  $('#ledIdx').addEventListener('input', () => { onLedIdx(); ledShowOne(); });
  $('#ledColor').addEventListener('input', onLedIdx);
  $('#ledOne').onclick = () => requireLink() && ledShowOne();
  $('#ledWalk').onclick = toggleWalk;
  $$('[data-fill]').forEach((b) => (b.onclick = () => { stopWalk(); stopStream(false); cmd(`LED FILL ${b.dataset.fill}`); }));
  $('#ledRelease').onclick = () => { stopWalk(); stopStream(false); cmd('LED FW'); };
  $$('[data-both]').forEach((b) => (b.onclick = async () => {
    stopWalk();
    if (await rgbCmd('EFS 0')) rgbCmd(`HSB ${b.dataset.both}`);
  }));
  onLedIdx();
  $$('[data-dtest]').forEach((b) => (b.onclick = () => cmd(`DISP TEST ${b.dataset.dtest}`)));
  $('#dispText').onclick = async () => {
    if (!requireLink()) return;
    await link.write('DISP TEST 0');
    await link.write('DISP AUTO 0');
    await link.write('DISP LINE 0 ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    await link.write('DISP LINE 1 abcdefghijklmnopqrstuvwxyz');
    await link.write('DISP LINE 2 0123456789 !?#%&*()[]<>');
  };
  const conSend = () => {
    const v = $('#conInput').value.trim();
    if (!v || !requireLink()) return;
    link.write(v);
    $('#conInput').value = '';
  };
  $('#conSend').onclick = conSend;
  $('#conInput').onkeydown = (e) => e.key === 'Enter' && conSend();
  $('#conClear').onclick = () => { $('#conLog').innerHTML = ''; };

  // Статистика
  stats = initStats({ $, settings, saveSettings, renderKeyboard, applyLabels, currentTab: () => currentTab });

  // Сборка и прошивка в одну кнопку
  initBuild({
    $, cs, toast, settings, saveSettings, flash, setFirmwareFiles, pick,
    currentTab: () => currentTab,
    notify: (ok) => { flashNotify(ok ? '00ff60' : 'ff2020', 2500); if (designer) designer.trigger(ok ? 'build_ok' : 'build_fail'); },
    beforeBuild: async () => {
      const km = state.keymap;
      if (km && km.dirty && km.path) await saveKeymap(false, true);
    },
    onRepoDir: async () => {
      $('#kmFromRepo').hidden = false;
      if (!state.keymap) await openFromRepo();
    },
  });

  // Трей и автозапуск
  $('#optAutostart').checked = await cs.autostart();
  $('#optAutostart').onchange = async () => { $('#optAutostart').checked = await cs.autostart($('#optAutostart').checked); };
  $('#optTray').checked = settings.minimizeToTray !== false;
  $('#optTray').onchange = () => saveSettings({ minimizeToTray: $('#optTray').checked });
  cs.tray.onAction((a) => {
    if (a === 'rgb-toggle') rgbCmd('TOG');
    if (a === 'stream-toggle') (streaming ? stopStream() : startStream());
  });
  link.addEventListener('close', updateTray);
  updateTray();

  if (settings.repoDir && !state.keymap) openFromRepo().catch(() => {});

  // Тренажёр
  trainer = initTrainer({ $, renderKeyboard, applyLabels, getLayers, setOverlay, clearOverlay, settings, saveSettings, leds, MH });

  // Профили и активное окно
  initProfiles({
    $, cs, settings, saveSettings, toast, pick, applyLight, applyScreen, setHotkeySet, effectOptions,
    onActiveWindow: (name) => { activeProc = name; updateHints(); },
  });

  // Свои наборы горячих клавиш
  $('#hkCustom').value = JSON.stringify(settings.customHotkeys || {}, null, 2);
  $('#hkSave').onclick = () => {
    try {
      const v = JSON.parse($('#hkCustom').value || '{}');
      saveSettings({ customHotkeys: v });
      $('#hkErr').textContent = 'Сохранено';
      updateHints();
    } catch (e) { $('#hkErr').textContent = 'Ошибка JSON: ' + e.message; }
  };
  $('#hkOn').onchange = updateHints;

  // Статус Claude и уведомления
  cs.onClaude(setClaude);
  cs.onNotify((n) => { if (designer) designer.trigger('notify'); flashNotify(String(n.color).replace('#', '').padEnd(6, '0'), n.ms); if (n.text) toast(n.text); });
  $$('[data-claude]').forEach((b) => (b.onclick = () => setClaude({ state: b.dataset.claude })));

  // Шпаргалка
  $('#kmPdf').onclick = exportPdf;

  // Конструктор экрана
  setInterval(async () => { try { sysCache = await cs.sysStats(); } catch { /* нет */ } }, 2000);
  designer = initScreenDesigner({
    $, settings, saveSettings, toast, link,
    currentTab: () => currentTab,
    canImage: () => state.info.img === '1',
    onEnable: () => { clearInterval(screenTimer); screenLive = false; },
    vars: screenVars,
    cs,
    lastKey: () => lastKeyTime,
  });

  // Игры и достижения
  games = initGames({ $, setOverlay, clearOverlay, settings, saveSettings, toast, flashNotify, MH, renderKeyboard, applyLabels });
  initAchievements({ $, settings, saveSettings, toast, flashNotify: (c, ms) => { flashNotify(c, ms); if (designer && c === 'ffd000') designer.trigger('achievement'); } });

  // Инструменты
  tools = initTools({
    $, cs, settings, saveSettings, toast, setOverlay, clearOverlay, flashNotify,
    onCalibWhite: (cal) => {
      if (!link.connected) return toast('Подключите клавиатуру', true);
      stopStream(false);
      link.write(`LED FILL ${rgbToHex([200 * cal.r, 200 * cal.g, 200 * cal.b])}`);
    },
  });

  // Звук для эквалайзера
  $('#audioBtn').onclick = async () => {
    if (audio.running) { stopAudio(); $('#audioBtn').textContent = '♪ Слушать звук компьютера'; return; }
    try {
      await startAudio();
      $('#audioBtn').textContent = '■ Перестать слушать';
      $('#audioStat').textContent = 'слушаю звук Windows';
    } catch (e) { toast('Не удалось получить звук: ' + e.message, true); }
  };
  updateHints();

  renderInfo();
  autoConnect();
}

init();
