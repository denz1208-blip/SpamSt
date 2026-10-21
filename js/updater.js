// ================= АВТООБНОВЛЕНИЕ ЧЕРЕЗ GITHUB =================
// Игра хранит кэш свежих файлов в localStorage и подменяет ими исходники при
// запуске. Кнопка «Проверить обновление» сравнивает локальную версию
// (version.json) с версией в репозитории и скачивает изменения с GitHub.
(function () {
  const REPO = 'denz1208-blip/SpamSt'; // ← репозиторий игры
  const BRANCH = 'main';
  const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
  const FILES = [
    'js/items.js', 'js/entities.js', 'js/rooms.js', 'js/game.js',
  ];
  const LS_KEY = 'isaac_updater_cache_v1';

  function getCache() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function setCache(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) {} }

  function cmpVer(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function checkUpdate() {
    let local = { version: '1.0.0' };
    try { local = await fetchJson('version.json'); } catch (e) {}
    const remote = await fetchJson(`${RAW}/version.json`);
    return { local, remote, newer: cmpVer(remote.version, local.version) > 0 };
  }

  async function downloadAll(progressCb) {
    const results = {};
    for (let i = 0; i < FILES.length; i++) {
      const f = FILES[i];
      progressCb && progressCb(i / FILES.length, f);
      const r = await fetch(`${RAW}/${f}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Файл ${f}: HTTP ${r.status}`);
      results[f] = await r.text();
    }
    // обновим и version.json локально (в кэше)
    try { results['version.json'] = await (await fetch(`${RAW}/version.json?t=${Date.now()}`, { cache: 'no-store' })).text(); } catch (e) {}
    progressCb && progressCb(1, 'готово');
    return results;
  }

  // --- Подмена исходников из кэша (вызывается СИНХРОННО до загрузки js/*.js) ---
  window.__updaterPreload = function () {
    const cache = getCache();
    for (const f of FILES) {
      if (cache[f] && cache[f].text) {
        document.write('<script src="' + URL.createObjectURL(new Blob([cache[f].text], { type: 'text/javascript' })) + '"><\/script>');
      }
    }
  };

  // --- UI ---
  function ensureUi() {
    let box = document.getElementById('updateBox');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'updateBox';
    box.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;font-family:monospace;' +
      'font-size:12px;background:#1a1410ee;color:#e8d9b0;border:2px solid #6b5442;padding:8px 10px;' +
      'border-radius:6px;max-width:300px;line-height:1.5;display:none';
    document.body.appendChild(box);
    return box;
  }
  function show(html) {
    const box = ensureUi();
    box.innerHTML = html;
    box.style.display = 'block';
  }

  async function runUpdate(auto) {
    try {
      show('⏳ Проверяю обновления на GitHub…');
      const { local, remote, newer } = await checkUpdate();
      if (!newer) {
        show(`✅ Версия <b>v${local.version}</b> актуальна.` +
          `<br><button id="updBtn" style="cursor:pointer">Проверить снова</button>` +
          (auto ? '' : '') + `<br><button id="updClr" style="cursor:pointer">Сбросить кэш</button>`);
        bindButtons();
        return;
      }
      show(`🆕 Есть обновление: <b>v${local.version} → v${remote.version}</b><br>${remote.notes || ''}` +
        `<br><button id="doUpd" style="cursor:pointer;margin-top:4px">▶ Обновить игру</button>`);
      document.getElementById('doUpd').onclick = doDownload;
      return;
    } catch (e) {
      show(`❌ ${e.message} (нет сети или репозиторий приватный)<br>` +
        `<button id="updBtn" style="cursor:pointer">Повторить</button>`);
      bindButtons();
    }
  }

  async function doDownload() {
    try {
      const cache = getCache();
      const files = await downloadAll((p, f) => show(`⬇️ <b>${Math.round(p * 100)}%</b> — ${f}`));
      for (const f in files) cache[f] = { text: files[f], ts: Date.now() };
      setCache(cache);
      show('✅ Обновлено! Перезагрузка…');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      show('❌ Ошибка загрузки: ' + e.message);
    }
  }

  function bindButtons() {
    const b = document.getElementById('updBtn');
    if (b) b.onclick = () => runUpdate(false);
    const c = document.getElementById('updClr');
    if (c) c.onclick = () => { localStorage.removeItem(LS_KEY); show('🧹 Кэш очищен.'); };
  }

  document.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('menu');
    if (menu) {
      const btn = document.createElement('button');
      btn.textContent = '🔄 ПРОВЕРИТЬ ОБНОВЛЕНИЕ';
      btn.style.cssText = 'margin-top:10px;font-size:12px;padding:6px 10px';
      btn.onclick = () => runUpdate(false);
      menu.appendChild(btn);
    }
    runUpdate(true);
  });
})();
