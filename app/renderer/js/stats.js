// Статистика: скорость печати, нажатия за день, тепловая карта, батарея с прогнозом.
import { KEYS } from './layout.js';

// Клавиши, которые не считаем «символами» при расчёте скорости (модификаторы и слои по умолчанию)
const NON_CHAR = new Set([12, 24, 36, 37, 40, 41]);
const today = () => new Date().toISOString().slice(0, 10);

export function initStats(ctx) {
  const { $, settings, saveSettings, renderKeyboard } = ctx;
  const st = settings.stats || { days: {}, battery: [] };
  let dirty = false;
  const recent = []; // времена нажатий-символов за последнюю минуту
  let peakWpm = 0;

  const kb = renderKeyboard($('#statsKb'), { showLeds: false });
  ctx.applyLabels(kb);

  function day(d = today()) {
    if (!st.days[d]) st.days[d] = { presses: 0, chars: 0, keys: {}, peak: 0 };
    return st.days[d];
  }

  function onPress(pos) {
    const d = day();
    d.presses++;
    d.keys[pos] = (d.keys[pos] || 0) + 1;
    if (!NON_CHAR.has(pos)) {
      d.chars++;
      recent.push(performance.now());
    }
    dirty = true;
  }

  function wpm() {
    const now = performance.now();
    while (recent.length && now - recent[0] > 60000) recent.shift();
    return Math.round(recent.length / 5);
  }

  function onInfo(info) {
    const bat = +info.bat;
    if (!(bat >= 0 && bat <= 100)) return;
    const last = st.battery[st.battery.length - 1];
    const now = Date.now();
    if (!last || now - last[0] > 5 * 60 * 1000 || Math.abs(last[1] - bat) >= 2) {
      st.battery.push([now, bat]);
      const weekAgo = now - 7 * 24 * 3600 * 1000;
      while (st.battery.length && st.battery[0][0] < weekAgo) st.battery.shift();
      dirty = true;
    }
  }

  function heat(range) {
    const keys = {};
    const days = Object.keys(st.days).sort().slice(range === 'today' ? -1 : range === 'week' ? -7 : -365);
    for (const dd of days) {
      if (range === 'today' && dd !== today()) continue;
      for (const [p, n] of Object.entries(st.days[dd].keys)) keys[p] = (keys[p] || 0) + n;
    }
    return keys;
  }

  function drawHeat() {
    const keys = heat($('#heatRange').value);
    const max = Math.max(1, ...Object.values(keys));
    KEYS.forEach((k) => {
      const n = keys[k.pos] || 0;
      const t = n / max;
      kb.setKeyColor(k.pos, n ? `hsla(${(1 - t) * 220}, 90%, 55%, ${0.25 + t * 0.75})` : '');
      kb.setIndex(k.pos, n ? String(n) : '');
    });
  }

  function forecast() {
    // Наклон по точкам последних 24 часов, пока заряд падает
    const pts = st.battery.filter(([t]) => Date.now() - t < 24 * 3600 * 1000);
    if (pts.length < 3) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let num = 0, den = 0;
    for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
    const slope = den ? num / den : 0; // % за мс
    if (slope >= -1e-9) return null;
    const hours = (pts[n - 1][1] / -slope) / 3600000;
    return hours;
  }

  function drawBattery() {
    const c = $('#batChart');
    const g = c.getContext('2d');
    const W = (c.width = c.clientWidth * devicePixelRatio), H = (c.height = 160 * devicePixelRatio);
    g.clearRect(0, 0, W, H);
    const now = Date.now(), from = now - 7 * 24 * 3600 * 1000;
    g.strokeStyle = '#2c313c';
    g.lineWidth = 1;
    g.fillStyle = '#8b93a5';
    g.font = `${11 * devicePixelRatio}px sans-serif`;
    for (const v of [0, 50, 100]) {
      const y = H - 14 * devicePixelRatio - (v / 100) * (H - 28 * devicePixelRatio);
      g.beginPath(); g.moveTo(30 * devicePixelRatio, y); g.lineTo(W, y); g.stroke();
      g.fillText(`${v}%`, 0, y + 4 * devicePixelRatio);
    }
    const pts = st.battery;
    if (pts.length > 1) {
      g.strokeStyle = '#5be3b0';
      g.lineWidth = 2 * devicePixelRatio;
      g.beginPath();
      pts.forEach(([t, v], i) => {
        const x = 30 * devicePixelRatio + ((t - from) / (now - from)) * (W - 30 * devicePixelRatio);
        const y = H - 14 * devicePixelRatio - (v / 100) * (H - 28 * devicePixelRatio);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    }
    const f = forecast();
    const last = pts[pts.length - 1];
    $('#batNow').textContent = last ? `${last[1]}%` : '—';
    $('#batLeft').textContent = f === null ? (last ? 'заряжается или мало данных' : '—')
      : f > 48 ? `≈ ${Math.round(f / 24)} дн.` : `≈ ${Math.round(f)} ч`;
  }

  function render() {
    const d = day();
    $('#stWpm').textContent = wpm();
    $('#stPeak').textContent = Math.max(peakWpm, d.peak || 0);
    $('#stToday').textContent = d.presses.toLocaleString('ru-RU');
    const week = Object.keys(st.days).sort().slice(-7).reduce((a, k) => a + st.days[k].presses, 0);
    $('#stWeek').textContent = week.toLocaleString('ru-RU');
    drawHeat();
    drawBattery();
  }

  setInterval(() => {
    const w = wpm();
    if (w > peakWpm) peakWpm = w;
    const d = day();
    if (w > (d.peak || 0)) { d.peak = w; dirty = true; }
    if (ctx.currentTab() === 'stats') {
      $('#stWpm').textContent = w;
      $('#stPeak').textContent = Math.max(peakWpm, d.peak || 0);
      $('#stToday').textContent = d.presses.toLocaleString('ru-RU');
    }
  }, 1000);
  setInterval(() => { if (dirty) { dirty = false; saveSettings({ stats: st }); } }, 10000);
  $('#heatRange').onchange = drawHeat;
  $('#statsReset').onclick = () => {
    st.days = {};
    st.battery = [];
    saveSettings({ stats: st });
    render();
  };

  return { onPress, onInfo, render, wpm, keyboard: kb };
}
