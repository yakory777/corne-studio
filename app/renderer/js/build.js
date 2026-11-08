// Сборка и прошивка в одну кнопку: git push → ожидание GitHub Actions → скачивание → прошивка.
// Плюс история прошивок с откатом.

export function initBuild(ctx) {
  const { $, cs, toast, settings, saveSettings, flash, setFirmwareFiles, pick } = ctx;
  let busy = false;

  const step = (text, cls = 'wait') => {
    const d = document.createElement('div');
    d.className = 'step ' + cls;
    d.textContent = text;
    $('#buildLog').appendChild(d);
    return d;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const repo = () => ($('#ghRepo').value || '').trim();

  async function refreshStatus() {
    const dir = settings.repoDir;
    $('#repoDir').textContent = dir || 'папка не выбрана';
    $('#buildBtn').disabled = !dir;
    if (!dir) return;
    try {
      const st = await cs.repo.status(dir);
      $('#repoChanges').textContent = st.changes ? `несохранённых изменений: ${st.changes}` : 'изменений нет';
    } catch (e) {
      $('#repoChanges').textContent = e.message;
    }
  }

  function addHistory(entry) {
    const h = (settings.flashHistory || []).filter((x) => x.runId !== entry.runId);
    h.unshift(entry);
    saveSettings({ flashHistory: h.slice(0, 20) });
    renderHistory();
  }

  function renderHistory() {
    const box = $('#history');
    const h = settings.flashHistory || [];
    box.innerHTML = h.length ? '' : '<p class="muted">Пока пусто — здесь появятся прошитые сборки.</p>';
    h.forEach((e, i) => {
      const d = document.createElement('div');
      d.className = 'item';
      d.innerHTML = '<span class="dot ok"></span><span class="grow"></span><span class="muted mono"></span><button class="btn ghost">Откатить</button>';
      d.children[1].textContent = e.title;
      d.children[2].textContent = `${e.sha} · ${new Date(e.date).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${i === 0 ? ' · текущая' : ''}`;
      d.children[3].onclick = () => rollback(e);
      box.appendChild(d);
    });
  }

  async function rollback(e) {
    try {
      toast(`Скачиваю сборку ${e.sha}…`);
      const files = await cs.gh.download(e.repo, e.runId);
      setFirmwareFiles(files);
      const half = await pick('Прошить эту сборку — на какую половину?', [
        { label: 'Главная половина', value: 'main' },
        { label: 'Вторая половина', value: 'other' },
        { label: 'Обе по очереди', value: 'both' },
      ]);
      if (!half) return;
      await flashHalves(half);
      addHistory({ ...e, date: new Date().toISOString() });
    } catch (err) {
      toast('Не удалось: ' + err.message + ' (артефакты GitHub хранятся 90 дней)', true);
    }
  }

  async function flashHalves(which) {
    const main = settings.mainSide || 'left';
    const other = main === 'left' ? 'right' : 'left';
    if (which === 'main' || which === 'both') {
      if (!(await flash(main, main))) return false;
    }
    if (which === 'other' || which === 'both') {
      if (which === 'both') {
        const ok = await pick(`Подключите ${other === 'left' ? 'левую' : 'правую'} половину по USB`, [
          { label: 'Готово, дальше', value: true }, { label: 'Пропустить', value: false },
        ]);
        if (!ok) return true;
      }
      return flash(other, other);
    }
    return true;
  }

  async function waitRun(sha, line) {
    const t0 = Date.now();
    let run = null;
    while (Date.now() - t0 < 20 * 60 * 1000) {
      const runs = await cs.gh.runs(repo());
      run = runs.find((r) => r.fullSha === sha);
      const sec = Math.round((Date.now() - t0) / 1000);
      if (!run) line.textContent = `Жду, пока GitHub запустит сборку… ${sec} с`;
      else if (run.status !== 'completed') line.textContent = `Сборка идёт (${run.status === 'queued' ? 'в очереди' : 'собирается'})… ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      else return run;
      await sleep(run ? 10000 : 5000);
    }
    throw new Error('Сборка не закончилась за 20 минут');
  }

  async function buildAndFlash() {
    if (busy) return;
    if (!repo()) return toast('Укажите репозиторий GitHub выше', true);
    if (!(await cs.token.has())) return toast('Нужен токен GitHub (поле выше) — без него нельзя скачать сборку', true);
    busy = true;
    $('#buildBtn').disabled = true;
    $('#buildLog').innerHTML = '';
    try {
      if (ctx.beforeBuild) await ctx.beforeBuild();
      const msg = ($('#buildMsg').value || '').trim() || 'Обновление из Corne Studio';
      const s1 = step('Отправляю изменения на GitHub…');
      const pub = await cs.repo.publish(settings.repoDir, msg);
      s1.className = 'step ok';
      s1.textContent = pub.committed ? `Изменения отправлены (${pub.sha.slice(0, 7)})` : `Новых изменений нет — собираю текущую версию (${pub.sha.slice(0, 7)})`;
      refreshStatus();

      const s2 = step('Жду сборку…');
      const run = await waitRun(pub.sha, s2);
      if (run.conclusion !== 'success') {
        if (ctx.notify) ctx.notify(false);
        s2.className = 'step err';
        s2.textContent = 'Сборка упала. Причина:';
        const fails = await cs.gh.failure(repo(), run.id).catch(() => []);
        for (const f of fails) {
          const d = step(`${f.name}\n${f.lines.length ? f.lines.join('\n') : '(строки с ошибкой не найдены — откройте лог на GitHub)'}`, 'err');
          d.style.whiteSpace = 'pre-wrap';
          d.classList.add('mono');
        }
        const a = step('Открыть сборку на GitHub', 'err');
        a.style.cursor = 'pointer';
        a.onclick = () => cs.openUrl(run.url);
        return;
      }
      s2.className = 'step ok';
      s2.textContent = 'Сборка готова';
      if (ctx.notify) ctx.notify(true);

      const s3 = step('Скачиваю прошивку…');
      const files = await cs.gh.download(repo(), run.id);
      setFirmwareFiles(files);
      s3.className = 'step ok';
      s3.textContent = `Скачано файлов: ${files.length}`;

      const which = await pick('Сборка готова. Что прошить?', [
        { label: 'Главную половину', sub: 'раскладка, экран, подсветка', value: 'main' },
        { label: 'Обе половины по очереди', value: 'both' },
        { label: 'Ничего, только скачать', value: null },
      ]);
      if (which) {
        step('Прошивка — подробности ниже, в блоке «2. Прошить»', 'ok');
        await flashHalves(which);
      }
      addHistory({ repo: repo(), runId: run.id, sha: run.sha, title: run.title, date: new Date().toISOString() });
      $('#buildMsg').value = '';
    } catch (e) {
      step(e.message, 'err');
    } finally {
      busy = false;
      $('#buildBtn').disabled = !settings.repoDir;
    }
  }

  $('#repoPick').onclick = async () => {
    try {
      const dir = await cs.repo.pick();
      if (!dir) return;
      await saveSettings({ repoDir: dir });
      refreshStatus();
      if (ctx.onRepoDir) ctx.onRepoDir(dir);
    } catch (e) { toast(e.message, true); }
  };
  $('#buildBtn').onclick = buildAndFlash;
  refreshStatus();
  renderHistory();
  setInterval(() => ctx.currentTab() === 'firmware' && !busy && refreshStatus(), 5000);

  return { buildAndFlash, refreshStatus };
}
