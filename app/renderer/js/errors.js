// Показывает ошибки прямо в окне — чтобы было что прислать, если что-то сломалось.
(function () {
  function show(msg) {
    var box = document.getElementById('errBanner');
    if (!box) {
      box = document.createElement('div');
      box.id = 'errBanner';
      box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99;background:#5a1620;color:#fff;font:13px Consolas,monospace;padding:10px 14px;white-space:pre-wrap;max-height:40vh;overflow:auto;border-bottom:2px solid #ff6b7a';
      box.title = 'Скопируйте этот текст и пришлите разработчику. Клик — скрыть.';
      box.onclick = function () { box.remove(); };
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent += (box.textContent ? '\n' : 'Ошибка в Corne Studio (клик — скрыть):\n') + msg;
  }
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      show('Не загрузился файл: ' + (e.target.src || e.target.href) + ' (или один из файлов, которые он подключает) — распакуйте полный архив Corne Studio заново.');
    } else {
      show((e.message || 'ошибка') + (e.filename ? '  [' + e.filename.split('/').slice(-2).join('/') + ':' + e.lineno + ']' : ''));
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    show('Promise: ' + (r && (r.stack || r.message) || r));
  });
})();
