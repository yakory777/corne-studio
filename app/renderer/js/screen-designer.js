// Конструктор экрана: страницы из элементов, ротация, перетаскивание, импорт картинок.
import {
  W, H, ELEMENT_TYPES, ICONS, ANIMS, FONT_NAMES, VARS, TEMPLATES, TEXT_EFFECTS,
  renderPage, bitsToHex, isAnimated, imageToBits, makePage, newId, lastHitBoxes,
  transition, bitsToPixels, pixelsToBits,
} from './oled.js';

export const EVENTS = {
  layer: 'смена слоя', claude_done: 'Claude закончил', claude_waiting: 'Claude ждёт ответа',
  build_ok: 'прошивка собрана', build_fail: 'сборка упала', notify: 'уведомление', achievement: 'достижение',
};
const TRANSITIONS = { none: 'без перехода', slide: 'сдвиг влево', up: 'сдвиг вверх', dissolve: 'растворение' };

export function initScreenDesigner(ctx) {
  const $$ = (q) => [...document.querySelectorAll(q)];
  const { $, settings, saveSettings, toast, link, vars, canImage, onEnable } = ctx;
  const design = settings.screenDesign || { enabled: false, contrast: 160, pages: [makePage('status'), makePage('bigclock')] };
  design.events = design.events || {};
  design.idle = design.idle || { page: -1, sec: 120 };
  design.night = design.night || { on: false, from: '23:00', to: '07:00', contrast: 8 };
  let override = null; // { idx, until } — страница по событию
  let shownIdx = -1;
  let prevBits = null, curBits = null, transStart = 0, transKind = 'none';
  let lastContrastSent = -1;
  let editMode = false, tool = 'pen', lineStart = null, painting = false;
  let curPage = 0;
  let selEl = null;
  let lastHex = '';
  let showIdx = 0;
  let showSince = performance.now();
  const save = () => saveSettings({ screenDesign: design });
  const page = () => design.pages[curPage];

  /* ---------------- страницы ---------------- */
  function renderPages() {
    const box = $('#sdPages');
    box.innerHTML = '';
    design.pages.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'item' + (i === curPage ? ' sel' : '');
      d.innerHTML = '<span class="grow"></span><span class="muted"></span>';
      d.children[0].textContent = `${i + 1}. ${p.name}`;
      d.children[1].textContent = design.pages.length > 1 ? `${p.duration} с` : '';
      d.onclick = () => { curPage = i; selEl = null; renderAll(); };
      box.appendChild(d);
    });
    const p = page();
    $('#sdPageProps').hidden = !p;
    if (!p) return;
    $('#sdPageName').value = p.name;
    $('#sdPageDur').value = p.duration;
    $('#sdPageInv').checked = !!p.invert;
    $('#sdPageTrans').value = p.transition || 'none';
  }

  /* ---------------- элементы ---------------- */
  function renderEls() {
    const box = $('#sdEls');
    box.innerHTML = '';
    const p = page();
    if (!p) return;
    p.elements.forEach((el) => {
      const d = document.createElement('div');
      d.className = 'item' + (el === selEl ? ' sel' : '');
      d.innerHTML = '<span class="grow"></span><button class="btn ghost" title="Показать/скрыть">👁</button><button class="btn ghost" title="Выше">↑</button><button class="btn ghost" title="Удалить">✕</button>';
      const label = el.type === 'text' || el.type === 'marquee' || el.type === 'seg' ? `«${el.text}»` : el.type === 'icon' ? ICONS[el.icon] : el.type === 'anim' ? ANIMS[el.anim]
        : ['graph', 'gauge', 'dots'].includes(el.type) ? el.value : el.type === 'gif' ? `${(el.frames || []).length} кадров` : '';
      if (el.cond) d.title = 'Показывается, если ' + el.cond;
      d.children[0].textContent = `${ELEMENT_TYPES[el.type].name} ${label}`;
      d.style.opacity = el.hidden ? 0.5 : 1;
      d.onclick = () => { selEl = el; renderEls(); renderProps(); };
      d.children[1].onclick = (e) => { e.stopPropagation(); el.hidden = !el.hidden; save(); renderEls(); };
      d.children[2].onclick = (e) => {
        e.stopPropagation();
        const i = p.elements.indexOf(el);
        if (i > 0) { p.elements.splice(i, 1); p.elements.splice(i - 1, 0, el); save(); renderEls(); }
      };
      d.children[3].onclick = (e) => { e.stopPropagation(); p.elements.splice(p.elements.indexOf(el), 1); if (selEl === el) selEl = null; save(); renderEls(); renderProps(); };
      box.appendChild(d);
    });
  }

  function field(label, input) {
    const row = document.createElement('label');
    row.className = 'sd-field';
    row.append(label, input);
    return row;
  }
  function numInput(el, key, min, max) {
    const i = document.createElement('input');
    i.type = 'number'; i.min = min; i.max = max; i.value = el[key];
    i.oninput = () => { el[key] = +i.value; save(); };
    return i;
  }
  function selInput(el, key, options) {
    const s = document.createElement('select');
    for (const [v, n] of Object.entries(options)) s.append(new Option(n, v));
    s.value = el[key];
    s.onchange = () => { el[key] = s.value; save(); renderEls(); };
    return s;
  }
  function textInput(el, key, wide = true) {
    const i = document.createElement('input');
    i.value = el[key] ?? '';
    if (wide) i.className = 'grow';
    i.oninput = () => { el[key] = i.value; save(); renderEls(); };
    return i;
  }
  function checkInput(el, key) {
    const i = document.createElement('input');
    i.type = 'checkbox'; i.checked = !!el[key];
    i.onchange = () => { el[key] = i.checked; save(); };
    return i;
  }

  function renderProps() {
    const box = $('#sdProps');
    box.innerHTML = '';
    if (!selEl) { box.innerHTML = '<p class="muted">Выберите элемент в списке или кликните по нему на экране. Тащите мышью, чтобы двигать.</p>'; return; }
    const el = selEl;
    const add = (l, i) => box.appendChild(field(l, i));
    if (el.type === 'text' || el.type === 'marquee') {
      const t = textInput(el, 'text');
      const row = document.createElement('div');
      row.className = 'row';
      row.append(t);
      box.appendChild(row);
      add('Размер', numInput(el, 'size', 6, 32));
      add('Шрифт', selInput(el, 'font', FONT_NAMES));
      add('Жирный', checkInput(el, 'bold'));
      if (el.font === 'custom') add('Имя шрифта', textInput(el, 'fontName'));
      if (el.type === 'text') add('Выравнивание', selInput(el, 'align', { left: 'слева', center: 'по центру', right: 'справа' }));
      if (el.type === 'text') add('Эффект', selInput(el, 'effect', TEXT_EFFECTS));
      if (el.type === 'marquee') add('Скорость', numInput(el, 'speed', 5, 150));
    }
    if (['graph', 'gauge', 'dots'].includes(el.type)) {
      const row = document.createElement('div'); row.className = 'row';
      row.append(el.type === 'dots' ? 'Номер (0, 1, 2…):' : 'Значение:', textInput(el, 'value'));
      box.appendChild(row);
    }
    if (el.type === 'graph') { add('Мин', numInput(el, 'min', -1000, 100000)); add('Макс', numInput(el, 'max', -1000, 100000)); add('Вид', selInput(el, 'style', { area: 'заливка', line: 'линия', bars: 'столбики' })); add('Шаг, сек', numInput(el, 'step', 0.1, 60)); }
    if (el.type === 'gauge') { add('Радиус', numInput(el, 'r', 5, 16)); add('Толщина', numInput(el, 'thick', 1, 6)); }
    if (el.type === 'clock') { add('Радиус', numInput(el, 'r', 5, 16)); add('Секундная', checkInput(el, 'seconds')); add('Деления', checkInput(el, 'ticks')); }
    if (el.type === 'seg') {
      const row = document.createElement('div'); row.className = 'row'; row.append(textInput(el, 'text')); box.appendChild(row);
      add('Высота', numInput(el, 'size', 8, 32)); add('Толщина', numInput(el, 'thick', 1, 5)); add('Мигающее «:»', checkInput(el, 'blink'));
    }
    if (el.type === 'dots') { add('Сколько', numInput(el, 'count', 1, 10)); add('Радиус', numInput(el, 'r', 1, 5)); add('Шаг', numInput(el, 'gap', 3, 30)); }
    if (el.type === 'keys') add('Масштаб', numInput(el, 'scale', 1, 3));
    if (el.type === 'line') { add('X2', numInput(el, 'x2', 0, 127)); add('Y2', numInput(el, 'y2', 0, 31)); add('Пунктир', checkInput(el, 'dash')); }
    if (el.type === 'bar') {
      const row = document.createElement('div'); row.className = 'row';
      row.append('Значение 0–100:', textInput(el, 'value'));
      box.appendChild(row);
    }
    if (el.type === 'icon') { add('Иконка', selInput(el, 'icon', ICONS)); add('Масштаб', numInput(el, 'scale', 1, 3)); }
    if (el.type === 'anim') add('Анимация', selInput(el, 'anim', ANIMS));
    if (el.type === 'frame') { add('Скругление', numInput(el, 'radius', 0, 12)); add('Залить', checkInput(el, 'fill')); }
    if (el.type !== 'marquee') { add('X', numInput(el, 'x', -128, 128)); }
    add('Y', numInput(el, 'y', -32, 32));
    if (['bar', 'anim', 'frame', 'graph'].includes(el.type)) { add('Ширина', numInput(el, 'w', 1, 128)); add('Высота', numInput(el, 'h', 1, 32)); }
    const cr = document.createElement('div'); cr.className = 'row';
    const ci = textInput(el, 'cond'); ci.placeholder = 'всегда (например: {bat} < 20)';
    cr.append('Показывать, если', ci);
    box.appendChild(cr);
    $('#sdPaint').hidden = el.type !== 'image';
    if (el.type !== 'image') setEdit(false);
  }

  function renderAll() { renderPages(); renderEls(); renderProps(); }

  /* ---------------- рисование пикселями ---------------- */
  function setEdit(on) {
    editMode = on;
    $('#sdEditBtn').classList.toggle('active', on);
    $('#sdEditBtn').textContent = on ? '✎ Рисую — тащить нельзя' : '✎ Рисовать';
    prev.style.cursor = on ? 'crosshair' : '';
  }
  function editPixels(fn) {
    const el = selEl;
    if (!el || el.type !== 'image') return;
    const px = bitsToPixels(el.bits, el.w, el.h);
    fn(px, el);
    el.bits = pixelsToBits(px, el.w, el.h);
  }
  function plot(px, el, x, y, val) {
    const sz = +$('#sdBrush').value || 1;
    for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) {
      const xx = x - el.x + dx, yy = y - el.y + dy;
      if (xx >= 0 && yy >= 0 && xx < el.w && yy < el.h) px[yy * el.w + xx] = val;
    }
  }
  function lineTo(px, el, x0, y0, x1, y1, val) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) plot(px, el, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), val);
  }
  function flood(px, el, x, y) {
    const sx = x - el.x, sy = y - el.y;
    if (sx < 0 || sy < 0 || sx >= el.w || sy >= el.h) return;
    const target = px[sy * el.w + sx], val = target ? 0 : 1;
    const stack = [[sx, sy]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= el.w || cy >= el.h || px[cy * el.w + cx] !== target) continue;
      px[cy * el.w + cx] = val;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  $$('[data-tool]').forEach((b) => (b.onclick = () => {
    tool = b.dataset.tool;
    $$('[data-tool]').forEach((x) => x.classList.toggle('active', x === b));
    setEdit(true);
  }));
  $('#sdEditBtn').onclick = () => setEdit(!editMode);
  $('#sdPxClear').onclick = () => { editPixels((px) => px.fill(0)); save(); };
  $('#sdPxInvert').onclick = () => { editPixels((px) => { for (let i = 0; i < px.length; i++) px[i] = px[i] ? 0 : 1; }); save(); };
  $('#sdPxFlip').onclick = () => { editPixels((px, el) => { for (let y = 0; y < el.h; y++) px.subarray(y * el.w, (y + 1) * el.w).reverse(); }); save(); };
  $('#sdNewDraw').onclick = () => {
    const el = { id: newId(), type: 'image', x: 0, y: 0, w: W, h: H, bits: pixelsToBits(new Uint8Array(W * H), W, H) };
    page().elements.push(el);
    selEl = el; save(); renderEls(); renderProps(); setEdit(true);
  };

  /* ---------------- предпросмотр и перетаскивание ---------------- */
  const prev = $('#sdPreview');
  let drag = null;
  const toPx = (e) => {
    const r = prev.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  prev.addEventListener('mousedown', (e) => {
    const [fx, fy] = toPx(e);
    if (editMode && selEl && selEl.type === 'image') {
      const x = Math.floor(fx), y = Math.floor(fy);
      const erase = tool === 'eraser' || e.button === 2;
      if (tool === 'fill') { editPixels((px, el) => flood(px, el, x, y)); save(); return; }
      if (tool === 'line' || tool === 'rect') { lineStart = [x, y]; return; }
      painting = { last: [x, y], val: erase ? 0 : 1 };
      editPixels((px, el) => plot(px, el, x, y, painting.val));
      return;
    }
    const [x, y] = [fx, fy];
    const hits = lastHitBoxes().filter((b) => x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1);
    const hit = hits[hits.length - 1];
    if (!hit) return;
    selEl = hit.el;
    drag = { x0: x, y0: y, ex: hit.el.x || 0, ey: hit.el.y };
    renderEls(); renderProps();
  });
  prev.addEventListener('contextmenu', (e) => editMode && e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (painting && selEl) {
      const [fx, fy] = toPx(e);
      const x = Math.floor(fx), y = Math.floor(fy);
      editPixels((px, el) => lineTo(px, el, painting.last[0], painting.last[1], x, y, painting.val));
      painting.last = [x, y];
      return;
    }
    if (!drag || !selEl) return;
    const [x, y] = toPx(e);
    if (selEl.type !== 'marquee') selEl.x = Math.round(drag.ex + x - drag.x0);
    selEl.y = Math.round(drag.ey + y - drag.y0);
  });
  window.addEventListener('mouseup', (e) => {
    if (painting) { painting = false; save(); return; }
    if (lineStart && selEl) {
      const [fx, fy] = toPx(e);
      const x = Math.floor(fx), y = Math.floor(fy), [x0, y0] = lineStart;
      editPixels((px, el) => {
        if (tool === 'line') lineTo(px, el, x0, y0, x, y, 1);
        else { lineTo(px, el, x0, y0, x, y0, 1); lineTo(px, el, x, y0, x, y, 1); lineTo(px, el, x, y, x0, y, 1); lineTo(px, el, x0, y, x0, y0, 1); }
      });
      lineStart = null; save();
      return;
    }
    if (drag) { drag = null; save(); renderProps(); }
  });

  /* ---------------- кнопки ---------------- */
  const tplSel = $('#sdTemplate');
  for (const [id, t] of Object.entries(TEMPLATES)) tplSel.append(new Option(t.name, id));
  $('#sdAddPage').onclick = () => {
    design.pages.push(makePage(tplSel.value));
    curPage = design.pages.length - 1; selEl = null; save(); renderAll(); renderEvents();
  };
  $('#sdDelPage').onclick = () => {
    if (design.pages.length <= 1) return toast('Должна остаться хотя бы одна страница', true);
    design.pages.splice(curPage, 1); curPage = Math.max(0, curPage - 1); selEl = null; save(); renderAll(); renderEvents();
  };
  $('#sdUpPage').onclick = () => {
    if (curPage === 0) return;
    const [p] = design.pages.splice(curPage, 1);
    design.pages.splice(--curPage, 0, p); save(); renderPages();
  };
  $('#sdPageName').oninput = () => { page().name = $('#sdPageName').value; save(); renderPages(); };
  $('#sdPageDur').oninput = () => { page().duration = Math.max(1, +$('#sdPageDur').value || 5); save(); };
  $('#sdPageInv').onchange = () => { page().invert = $('#sdPageInv').checked; save(); };
  for (const [k, n] of Object.entries(TRANSITIONS)) $('#sdPageTrans').append(new Option(n, k));
  $('#sdPageTrans').onchange = () => { page().transition = $('#sdPageTrans').value; save(); };

  const typeSel = $('#sdElType');
  for (const [id, t] of Object.entries(ELEMENT_TYPES)) if (id !== 'image' && id !== 'gif') typeSel.append(new Option(t.name, id));
  $('#sdAddEl').onclick = () => {
    const el = { id: newId(), type: typeSel.value, ...structuredClone(ELEMENT_TYPES[typeSel.value].defaults) };
    page().elements.push(el);
    selEl = el; save(); renderEls(); renderProps();
  };

  // Импорт картинки: PNG/JPG/GIF → 1 бит с дизерингом
  $('#sdImgFile').onchange = async () => {
    const f = $('#sdImgFile').files[0];
    if (!f) return;
    if (/gif|webp|apng/i.test(f.type) && 'ImageDecoder' in window) {
      try {
        const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: f.type });
        await dec.tracks.ready;
        const count = Math.min(dec.tracks.selectedTrack.frameCount, 60);
        if (count > 1) {
          const full = $('#sdImgFull').checked;
          const w = full ? W : 32, h = H;
          const frames = [];
          const cv = document.createElement('canvas');
          for (let i = 0; i < count; i++) {
            const { image } = await dec.decode({ frameIndex: i });
            cv.width = image.displayWidth; cv.height = image.displayHeight;
            cv.getContext('2d').drawImage(image, 0, 0);
            frames.push({ ms: Math.max(40, Math.round((image.duration || 100000) / 1000)), bits: imageToBits(cv, w, h, { dither: $('#sdImgDither').checked, invert: $('#sdImgInvert').checked, threshold: +$('#sdImgThr').value }) });
            image.close();
          }
          const el = { id: newId(), type: 'gif', x: 0, y: 0, w, h, frames };
          page().elements.unshift(el);
          selEl = el; save(); renderEls(); renderProps();
          toast(`GIF: ${frames.length} кадров`);
          $('#sdImgFile').value = '';
          return;
        }
      } catch (e) { toast('GIF не разобрать: ' + e.message, true); }
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const full = $('#sdImgFull').checked;
      const w = full ? W : 32, h = 32;
      const bits = imageToBits(img, w, h, { dither: $('#sdImgDither').checked, invert: $('#sdImgInvert').checked, threshold: +$('#sdImgThr').value });
      const el = { id: newId(), type: 'image', x: full ? 0 : 0, y: 0, w, h, bits };
      page().elements.unshift(el);
      selEl = el; save(); renderEls(); renderProps();
      URL.revokeObjectURL(url);
      $('#sdImgFile').value = '';
    };
    img.src = url;
  };
  $('#sdImgBtn').onclick = () => $('#sdImgFile').click();

  $('#sdOn').checked = !!design.enabled;
  $('#sdOn').onchange = () => {
    design.enabled = $('#sdOn').checked;
    save();
    lastHex = '';
    if (design.enabled) {
      if (onEnable) onEnable();
      if (link.connected && !canImage()) toast('Прошивка клавиатуры не умеет картинки — обновите прошивку (модуль 0.3.0+)', true);
    } else if (link.connected) link.write('DISP MODE TEXT');
  };
  $('#sdContrast').value = design.contrast;
  $('#sdContrast').onchange = () => {
    design.contrast = +$('#sdContrast').value; save();
    if (link.connected && canImage()) link.write(`DISP CONTRAST ${design.contrast}`);
  };

  $('#sdVars').innerHTML = Object.entries(VARS).map(([k, d]) => `<code title="${d}">${k}</code>`).join(' ');
  $('#sdVars').onclick = (e) => {
    if (e.target.tagName !== 'CODE' || !selEl || !('text' in selEl)) return;
    selEl.text += e.target.textContent; save(); renderProps(); renderEls();
  };

  /* ---------------- реакции, заставка, ночной режим ---------------- */
  function renderEvents() {
    const box = $('#sdEvents');
    box.innerHTML = '';
    const pageOpts = [['-1', '—'], ...design.pages.map((p, i) => [String(i), `${i + 1}. ${p.name}`])];
    const mkSel = (val, on) => {
      const s = document.createElement('select');
      for (const [v, n] of pageOpts) s.append(new Option(n, v));
      s.value = String(val ?? -1);
      s.onchange = () => on(+s.value);
      return s;
    };
    for (const [id, name] of Object.entries(EVENTS)) {
      const ev = design.events[id] || { page: -1, sec: 4 };
      const row = document.createElement('div');
      row.className = 'row';
      const sec = document.createElement('input');
      sec.type = 'number'; sec.min = 1; sec.max = 60; sec.value = ev.sec; sec.style.width = '56px';
      sec.oninput = () => { ev.sec = +sec.value || 4; design.events[id] = ev; save(); };
      const lab = document.createElement('span'); lab.style.cssText = 'width:150px;flex:none'; lab.textContent = name;
      row.append(lab, mkSel(ev.page, (v) => { ev.page = v; design.events[id] = ev; save(); }), sec, 'сек');
      box.appendChild(row);
    }
    const idleRow = document.createElement('div');
    idleRow.className = 'row';
    const isec = document.createElement('input');
    isec.type = 'number'; isec.min = 10; isec.value = design.idle.sec; isec.style.width = '64px';
    isec.oninput = () => { design.idle.sec = Math.max(10, +isec.value || 120); save(); };
    const lab = document.createElement('span'); lab.style.cssText = 'width:150px;flex:none'; lab.textContent = 'заставка в простое';
    idleRow.append(lab, mkSel(design.idle.page, (v) => { design.idle.page = v; save(); }), 'через', isec, 'сек');
    box.appendChild(idleRow);
  }
  $('#sdNightOn').checked = design.night.on;
  $('#sdNightFrom').value = design.night.from;
  $('#sdNightTo').value = design.night.to;
  $('#sdNightC').value = design.night.contrast;
  ['#sdNightOn', '#sdNightFrom', '#sdNightTo', '#sdNightC'].forEach((id) => $(id).addEventListener('change', () => {
    design.night = { on: $('#sdNightOn').checked, from: $('#sdNightFrom').value, to: $('#sdNightTo').value, contrast: +$('#sdNightC').value };
    lastContrastSent = -1; save();
  }));
  function isNight() {
    if (!design.night.on) return false;
    const m = (s) => { const [h, mm] = String(s).split(':').map(Number); return h * 60 + (mm || 0); };
    const now = new Date(), cur = now.getHours() * 60 + now.getMinutes(), a = m(design.night.from), b = m(design.night.to);
    return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
  }
  function trigger(name) {
    const ev = design.events[name];
    if (!ev || ev.page < 0 || !design.pages[ev.page]) return;
    override = { idx: ev.page, until: performance.now() + (ev.sec || 4) * 1000 };
  }

  // Экспорт / импорт дизайна
  $('#sdExport').onclick = async () => {
    const p = await ctx.cs.saveText('corne-screen.json', JSON.stringify(design, null, 2));
    if (p) toast('Дизайн сохранён');
  };
  $('#sdImport').onclick = async () => {
    const txt = await ctx.cs.openText();
    if (!txt) return;
    try {
      const d = JSON.parse(txt);
      if (!Array.isArray(d.pages)) throw new Error('нет страниц');
      Object.assign(design, d);
      curPage = 0; selEl = null; save(); renderAll(); renderEvents();
      toast('Дизайн загружен');
    } catch (e) { toast('Не тот файл: ' + e.message, true); }
  };

  /* ---------------- цикл: предпросмотр + отправка ---------------- */
  setInterval(() => {
    const t = performance.now() / 1000;
    const v = vars();
    // Какая страница сейчас на клавиатуре: событие → заставка → ротация
    const cur = design.pages[showIdx] || design.pages[0];
    if (design.pages.length > 1 && performance.now() - showSince > (cur.duration || 8) * 1000) {
      showIdx = (showIdx + 1) % design.pages.length;
      showSince = performance.now();
    }
    let idx = showIdx;
    if (override && performance.now() < override.until) idx = override.idx;
    else {
      override = null;
      const idleMs = performance.now() - (ctx.lastKey ? ctx.lastKey() : 0);
      if (design.idle.page >= 0 && design.pages[design.idle.page] && idleMs > design.idle.sec * 1000) idx = design.idle.page;
    }
    if (design.enabled && link.connected && canImage()) {
      const sp = design.pages[idx] || design.pages[0];
      if (sp) {
        if (idx !== shownIdx) {
          prevBits = curBits; transStart = performance.now(); transKind = sp.transition || 'none'; shownIdx = idx;
        }
        const k = Math.min(1, (performance.now() - transStart) / 450);
        const inTrans = prevBits && k < 1 && transKind !== 'none';
        if (inTrans || isAnimated(sp) || !(Math.floor(t * 12) % 6)) {
          curBits = renderPage(sp, v, t).bits;
          const bits = inTrans ? transition(prevBits, curBits, k, transKind) : curBits;
          const hex = bitsToHex(bits);
          if (hex !== lastHex) { lastHex = hex; link.sendStream('disp', `DISP IMG ${hex}`); }
        }
        const wantC = isNight() ? design.night.contrast : design.contrast;
        if (wantC !== lastContrastSent) { lastContrastSent = wantC; link.write(`DISP CONTRAST ${wantC}`); }
      }
    }
    // Предпросмотр рисуем последним — по нему считаются области для перетаскивания
    if (ctx.currentTab() === 'screen' && page()) {
      const { canvas } = renderPage(page(), v, t);
      const g = prev.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(canvas, 0, 0, prev.width, prev.height);
      if (selEl) {
        const b = lastHitBoxes().find((x) => x.el === selEl);
        if (b) {
          const kk = prev.width / W;
          g.strokeStyle = editMode ? '#5be3b0' : '#ffb35c'; g.setLineDash([4, 3]);
          g.strokeRect(b.x * kk, b.y * kk, b.w * kk, b.h * kk);
          g.setLineDash([]);
        }
      }
      if (editMode) { // сетка пикселей
        const kk = prev.width / W;
        g.strokeStyle = 'rgba(255,255,255,.06)';
        g.beginPath();
        for (let x = 0; x <= W; x += 1) { g.moveTo(x * kk + 0.5, 0); g.lineTo(x * kk + 0.5, prev.height); }
        for (let y = 0; y <= H; y += 1) { g.moveTo(0, y * kk + 0.5); g.lineTo(prev.width, y * kk + 0.5); }
        g.stroke();
      }
    }
  }, 1000 / 12);

  renderAll();
  renderEvents();
  return {
    trigger,
    refreshEvents: renderEvents,
    enabled: () => design.enabled,
    disable: () => { if (design.enabled) { design.enabled = false; $('#sdOn').checked = false; save(); } },
    resend: () => { lastHex = ''; lastContrastSent = -1; },
  };
}
