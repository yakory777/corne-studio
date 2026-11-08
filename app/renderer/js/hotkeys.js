// Подсказки горячих клавиш: зажал модификатор — подсвечиваются клавиши, у которых есть действие.

export const HOTKEY_SETS = {
  windows: {
    name: 'Windows',
    match: [],
    combos: {
      Ctrl: { A: 'Выделить всё', C: 'Копировать', V: 'Вставить', X: 'Вырезать', Z: 'Отменить', Y: 'Повторить', S: 'Сохранить', O: 'Открыть', N: 'Создать', P: 'Печать', F: 'Найти', W: 'Закрыть вкладку', T: 'Новая вкладка', R: 'Обновить' },
      'Ctrl+Shift': { ESC: 'Диспетчер задач', T: 'Вернуть закрытую вкладку', N: 'Новая папка / окно инкогнито' },
      Win: { D: 'Рабочий стол', E: 'Проводник', L: 'Заблокировать', R: 'Выполнить', V: 'История буфера обмена', I: 'Параметры', TAB: 'Представление задач', DOT: 'Эмодзи' },
      'Win+Shift': { S: 'Скриншот области' },
      Alt: { TAB: 'Переключить окно', F4: 'Закрыть окно' },
    },
  },
  vscode: {
    name: 'VS Code',
    match: ['code'],
    combos: {
      Ctrl: { P: 'Быстро открыть файл', B: 'Боковая панель', FSLH: 'Закомментировать', D: 'Следующее совпадение', G: 'Перейти к строке', F: 'Найти', H: 'Заменить', GRAVE: 'Терминал', S: 'Сохранить', W: 'Закрыть вкладку', Z: 'Отменить', SPACE: 'Подсказки', TAB: 'Переключить вкладку' },
      'Ctrl+Shift': { P: 'Палитра команд', F: 'Поиск по проекту', E: 'Проводник', K: 'Удалить строку', GRAVE: 'Новый терминал' },
      Alt: { UP: 'Строку вверх', DOWN: 'Строку вниз' },
      'Shift+Alt': { F: 'Форматировать документ', DOWN: 'Копировать строку вниз', UP: 'Копировать строку вверх' },
    },
  },
  kompas: {
    name: 'КОМПАС-3D',
    match: ['kompas', 'kstudy'],
    note: 'Пока только общие сочетания Windows — дополните своими сочетаниями КОМПАСа в редакторе наборов.',
    combos: {
      Ctrl: { N: 'Создать', O: 'Открыть', S: 'Сохранить', P: 'Печать', Z: 'Отменить', Y: 'Повторить', C: 'Копировать', V: 'Вставить', X: 'Вырезать', A: 'Выделить всё' },
    },
  },
};

const MOD_OF = {
  LCTRL: 'Ctrl', RCTRL: 'Ctrl', LEFT_CONTROL: 'Ctrl', RIGHT_CONTROL: 'Ctrl',
  LSHFT: 'Shift', RSHFT: 'Shift', LSHIFT: 'Shift', RSHIFT: 'Shift', LEFT_SHIFT: 'Shift', RIGHT_SHIFT: 'Shift',
  LALT: 'Alt', RALT: 'Alt', LEFT_ALT: 'Alt', RIGHT_ALT: 'Alt',
  LGUI: 'Win', RGUI: 'Win', LWIN: 'Win', RWIN: 'Win', LEFT_GUI: 'Win', RIGHT_GUI: 'Win',
};
const ORDER = ['Ctrl', 'Win', 'Shift', 'Alt'];

/** Модификаторы, зажатые сейчас, в каноническом виде: «Ctrl+Shift» */
export function heldCombo(pressed, layer0) {
  const mods = new Set();
  for (const pos of pressed) {
    const b = layer0[pos] || '';
    const m = /^&kp (\w+)$/.exec(b);
    if (m && MOD_OF[m[1]]) mods.add(MOD_OF[m[1]]);
  }
  return ORDER.filter((m) => mods.has(m)).join('+');
}

export function isModifierBinding(b) {
  const m = /^&kp (\w+)$/.exec(b || '');
  return !!(m && MOD_OF[m[1]]);
}

export function allSets(custom) {
  return { ...HOTKEY_SETS, ...(custom || {}) };
}

/** Набор по имени процесса активного окна */
export function setForProcess(sets, proc) {
  const p = (proc || '').toLowerCase();
  for (const [id, s] of Object.entries(sets)) {
    if ((s.match || []).some((m) => p.startsWith(m.toLowerCase()))) return id;
  }
  return 'windows';
}
