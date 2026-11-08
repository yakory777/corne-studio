// Профили: подсветка + экран + набор горячих клавиш одним кликом; автопереключение по активному окну.
import { allSets } from './hotkeys.js';

const SCREEN_MODES = { keep: 'не менять', text: 'мой текст', clock: 'часы', sys: 'загрузка ПК', keys: 'счётчик нажатий', claude: 'статус Claude' };

export const DEFAULT_PROFILES = [
  { id: 'work', name: 'Работа', light: 'zmk', screen: 'clock', lines: ['', '', ''], hotkeys: 'auto' },
  { id: 'kompas', name: 'КОМПАС', light: 'b:layer', screen: 'sys', lines: ['', '', ''], hotkeys: 'kompas' },
  { id: 'code', name: 'Код', light: 'b:heat', screen: 'claude', lines: ['', '', ''], hotkeys: 'vscode' },
  { id: 'game', name: 'Игры', light: 'b:rainbow', screen: 'keys', lines: ['', '', ''], hotkeys: 'windows' },
];
const DEFAULT_RULES = [
  { process: 'KOMPAS', profile: 'kompas' },
  { process: 'Code', profile: 'code' },
];

export function initProfiles(ctx) {
  const { $, settings, saveSettings, toast, pick, applyLight, applyScreen, setHotkeySet, effectOptions } = ctx;
  let profiles = settings.profiles || structuredClone(DEFAULT_PROFILES);
  let rules = settings.profileRules || structuredClone(DEFAULT_RULES);
  let current = settings.currentProfile || null;
  let sel = profiles[0]?.id;
  let activeWindow = '';
  const save = () => saveSettings({ profiles, profileRules: rules, currentProfile: current });

  function apply(id, why = '') {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    current = id;
    applyLight(p.light);
    if (p.screen !== 'keep') applyScreen(p.screen, p.lines);
    setHotkeySet(p.hotkeys);
    save();
    renderList();
    $('#profNow').textContent = p.name;
    if (why) toast(`Профиль «${p.name}» — ${why}`);
  }

  function renderList() {
    const box = $('#profList');
    box.innerHTML = '';
    for (const p of profiles) {
      const d = document.createElement('div');
      d.className = 'item' + (p.id === sel ? ' sel' : '');
      d.innerHTML = `<span class="dot ${p.id === current ? 'ok' : ''}"></span><span class="grow"></span><button class="btn">Включить</button>`;
      d.children[1].textContent = p.name;
      d.onclick = () => { sel = p.id; renderList(); renderEditor(); };
      d.children[2].onclick = (e) => { e.stopPropagation(); apply(p.id); };
      box.appendChild(d);
    }
  }

  function fillSelect(el, options, value) {
    el.innerHTML = '';
    for (const [v, label] of options) el.append(new Option(label, v));
    el.value = value;
  }

  function renderEditor() {
    const p = profiles.find((x) => x.id === sel);
    $('#profEditor').hidden = !p;
    if (!p) return;
    $('#pfName').value = p.name;
    fillSelect($('#pfLight'), [['off', 'выключить'], ['zmk', 'встроенная ZMK'], ...effectOptions()], p.light);
    fillSelect($('#pfScreen'), Object.entries(SCREEN_MODES), p.screen);
    const sets = allSets(settings.customHotkeys);
    fillSelect($('#pfHotkeys'), [['auto', 'по активному окну'], ...Object.entries(sets).map(([id, s]) => [id, s.name])], p.hotkeys);
    ['#pfL0', '#pfL1', '#pfL2'].forEach((s, i) => { $(s).value = p.lines[i] || ''; });
  }

  function readEditor() {
    const p = profiles.find((x) => x.id === sel);
    if (!p) return;
    p.name = $('#pfName').value.trim() || 'Профиль';
    p.light = $('#pfLight').value;
    p.screen = $('#pfScreen').value;
    p.hotkeys = $('#pfHotkeys').value;
    p.lines = ['#pfL0', '#pfL1', '#pfL2'].map((s) => $(s).value);
    save();
    renderList();
  }

  function renderRules() {
    const box = $('#ruleList');
    box.innerHTML = rules.length ? '' : '<p class="muted">Правил нет.</p>';
    rules.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'item';
      d.innerHTML = '<span class="mono grow"></span><span class="muted"></span><button class="btn ghost">✕</button>';
      d.children[0].textContent = r.process;
      d.children[1].textContent = '→ ' + (profiles.find((p) => p.id === r.profile)?.name || '?');
      d.children[2].onclick = () => { rules.splice(i, 1); save(); renderRules(); };
      box.appendChild(d);
    });
  }

  ['#pfName', '#pfL0', '#pfL1', '#pfL2'].forEach((s) => $(s).addEventListener('change', readEditor));
  ['#pfLight', '#pfScreen', '#pfHotkeys'].forEach((s) => $(s).addEventListener('change', readEditor));
  $('#profAdd').onclick = async () => {
    const name = await pick('Название профиля', [], { input: 'Новый профиль' });
    if (!name) return;
    const p = { id: 'p' + Date.now(), name, light: 'zmk', screen: 'keep', lines: ['', '', ''], hotkeys: 'auto' };
    profiles.push(p);
    sel = p.id;
    save(); renderList(); renderEditor();
  };
  $('#profDel').onclick = () => {
    profiles = profiles.filter((p) => p.id !== sel);
    rules = rules.filter((r) => r.profile !== sel);
    sel = profiles[0]?.id;
    save(); renderList(); renderEditor(); renderRules();
  };
  $('#ruleAdd').onclick = async () => {
    if (!activeWindow) return toast('Переключитесь в нужную программу и вернитесь — она появится здесь', true);
    const prof = await pick(`Какой профиль включать в «${activeWindow}»?`, profiles.map((p) => ({ label: p.name, value: p.id })));
    if (!prof) return;
    rules = rules.filter((r) => r.process.toLowerCase() !== activeWindow.toLowerCase());
    rules.push({ process: activeWindow, profile: prof });
    save(); renderRules();
  };
  $('#profAuto').checked = settings.profileAuto !== false;
  $('#profAuto').onchange = () => saveSettings({ profileAuto: $('#profAuto').checked });

  ctx.cs.onActiveWindow((name) => {
    activeWindow = name;
    $('#activeWin').textContent = name;
    ctx.onActiveWindow && ctx.onActiveWindow(name);
    if (!$('#profAuto').checked) return;
    const r = rules.find((x) => name.toLowerCase().startsWith(x.process.toLowerCase()));
    if (r && r.profile !== current) apply(r.profile, `открыт ${name}`);
  });

  renderList();
  renderEditor();
  renderRules();
  if (current) $('#profNow').textContent = profiles.find((p) => p.id === current)?.name || '—';
  return { apply, current: () => current };
}
