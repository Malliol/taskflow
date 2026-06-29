/* TaskFlow — простой менеджер задач с прогресс-баром.
 * Данные хранятся в git: Cloudflare Worker коммитит tasks.json в репозиторий.
 * localStorage используется как офлайн-кеш; экспорт/импорт — резервный способ. */
(function () {
  "use strict";

  const STORAGE_KEY = "taskflow.tasks.v1";
  const THEME_KEY = "taskflow.theme";
  const WORKER_KEY = "taskflow.workerUrl";

  // URL Cloudflare Worker'а. Подставляется при деплое; можно переопределить
  // через localStorage["taskflow.workerUrl"].
  const WORKER_URL = (localStorage.getItem(WORKER_KEY) || "https://taskflow-worker.nik-mirosh.workers.dev").replace(/\/+$/, "");
  const workerConfigured = WORKER_URL && WORKER_URL.indexOf("__WORKER") === -1;

  let syncTimer = null;

  /** @type {{id:string, text:string, done:boolean, priority:string, createdAt:number}[]} */
  let tasks = [];
  let currentFilter = "all";

  // --- DOM ---
  const form = document.getElementById("taskForm");
  const input = document.getElementById("taskInput");
  const prioritySelect = document.getElementById("prioritySelect");
  const list = document.getElementById("taskList");
  const emptyState = document.getElementById("emptyState");
  const filters = document.getElementById("filters");
  const progressBar = document.getElementById("progressBar");
  const progressPercent = document.getElementById("progressPercent");
  const progressStats = document.getElementById("progressStats");
  const progressTrack = progressBar.parentElement;
  const themeToggle = document.getElementById("themeToggle");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");
  const dataStatus = document.getElementById("dataStatus");

  // --- Persistence ---
  function load() {
    try {
      tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      tasks = [];
    }
  }

  // Оптимистично кешируем локально и планируем синхронизацию в git.
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    if (workerConfigured) {
      scheduleSync();
    } else {
      setDataStatus("Сохранено локально (Worker не настроен)", true);
    }
  }

  function setDataStatus(text, dirty) {
    dataStatus.textContent = text;
    dataStatus.style.color = dirty ? "var(--prio-medium)" : "var(--text-muted)";
  }

  // --- Синхронизация с Cloudflare Worker (пишет в git) ---
  // Дебаунс: коммитим через 2с после последнего изменения, чтобы не плодить коммиты.
  function scheduleSync() {
    setDataStatus("Изменено — сохраняю в git…", true);
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(syncToWorker, 2000);
  }

  function syncToWorker() {
    setDataStatus("Сохранение в git…", false);
    fetch(WORKER_URL + "/api/tasks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: tasks }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d && d.error ? d.error : "ошибка запроса");
        setDataStatus("✓ Сохранено в git " + new Date().toLocaleTimeString(), false);
      })
      .catch((e) => {
        setDataStatus("⚠ Не удалось записать в git (сохранено локально): " + e.message, true);
      });
  }

  function loadFromWorker() {
    return fetch(WORKER_URL + "/api/tasks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.tasks)) return false;
        tasks = data.tasks.map(normalizeTask).filter(Boolean);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
        return true;
      })
      .catch(() => false);
  }

  // Приводим произвольный объект к валидной задаче.
  function normalizeTask(raw) {
    if (!raw || typeof raw.text !== "string") return null;
    return {
      id: raw.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      text: raw.text,
      done: Boolean(raw.done),
      priority: ["low", "medium", "high"].includes(raw.priority) ? raw.priority : "medium",
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    };
  }

  // --- Git: экспорт / импорт tasks.json ---
  function exportTasks() {
    const payload = JSON.stringify({ version: 1, tasks: tasks }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tasks.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDataStatus("Файл tasks.json скачан — закоммитьте его в репозиторий", false);
  }

  function importTasks(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result));
        const arr = Array.isArray(data) ? data : data.tasks;
        if (!Array.isArray(arr)) throw new Error("нет массива задач");
        tasks = arr.map(normalizeTask).filter(Boolean);
        save();
        render();
        setDataStatus(`Импортировано задач: ${tasks.length}`, false);
      } catch (e) {
        setDataStatus("Не удалось прочитать файл: " + e.message, true);
      }
    };
    reader.readAsText(file);
  }

  // Подтягиваем tasks.json из репозитория, если локально пусто.
  function seedFromRepo() {
    return fetch("tasks.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return false;
        const arr = Array.isArray(data) ? data : data.tasks;
        if (!Array.isArray(arr) || arr.length === 0) return false;
        tasks = arr.map(normalizeTask).filter(Boolean);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
        return true;
      })
      .catch(() => false);
  }

  // --- Mutations ---
  function addTask(text, priority) {
    tasks.unshift({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      text: text,
      done: false,
      priority: priority,
      createdAt: Date.now(),
    });
    save();
    render();
  }

  function toggleTask(id) {
    const t = tasks.find((x) => x.id === id);
    if (t) {
      t.done = !t.done;
      save();
      render();
    }
  }

  function deleteTask(id) {
    tasks = tasks.filter((x) => x.id !== id);
    save();
    render();
  }

  function clearDone() {
    tasks = tasks.filter((x) => !x.done);
    save();
    render();
  }

  // --- Rendering ---
  function visibleTasks() {
    if (currentFilter === "active") return tasks.filter((t) => !t.done);
    if (currentFilter === "done") return tasks.filter((t) => t.done);
    return tasks;
  }

  function updateProgress() {
    const total = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    progressBar.style.width = pct + "%";
    progressPercent.textContent = pct + "%";
    progressTrack.setAttribute("aria-valuenow", String(pct));

    if (total === 0) {
      progressStats.textContent = "Нет задач — добавьте первую!";
    } else if (pct === 100) {
      progressStats.textContent = "🎉 Все задачи выполнены!";
    } else {
      progressStats.textContent = `Выполнено ${done} из ${total}`;
    }
  }

  function render() {
    const items = visibleTasks();
    list.innerHTML = "";

    items.forEach((t) => {
      const li = document.createElement("li");
      li.className = "task" + (t.done ? " is-done" : "");
      li.dataset.id = t.id;
      li.dataset.priority = t.priority;

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "task__check";
      check.checked = t.done;
      check.setAttribute("aria-label", "Отметить выполненной");
      check.addEventListener("change", () => toggleTask(t.id));

      const span = document.createElement("span");
      span.className = "task__text";
      span.textContent = t.text;

      const del = document.createElement("button");
      del.className = "task__delete";
      del.type = "button";
      del.textContent = "✕";
      del.title = "Удалить";
      del.setAttribute("aria-label", "Удалить задачу");
      del.addEventListener("click", () => deleteTask(t.id));

      li.append(check, span, del);
      list.appendChild(li);
    });

    emptyState.classList.toggle("hidden", items.length !== 0);
    updateProgress();
  }

  // --- Events ---
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addTask(text, prioritySelect.value);
    input.value = "";
    input.focus();
  });

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.dataset.action === "clear-done") {
      clearDone();
      return;
    }
    if (btn.dataset.filter) {
      currentFilter = btn.dataset.filter;
      filters.querySelectorAll(".filter").forEach((b) =>
        b.classList.toggle("is-active", b === btn)
      );
      render();
    }
  });

  // --- Theme ---
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
    localStorage.setItem(THEME_KEY, theme);
  }

  exportBtn.addEventListener("click", exportTasks);
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importTasks(file);
    e.target.value = "";
  });

  themeToggle.addEventListener("click", () => {
    const next =
      document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  // --- Init ---
  const savedTheme =
    localStorage.getItem(THEME_KEY) ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(savedTheme);

  load();
  render(); // мгновенно показываем кеш, пока грузим свежие данные

  if (workerConfigured) {
    setDataStatus("Загрузка из git…", false);
    loadFromWorker().then((ok) => {
      render();
      setDataStatus(ok ? "Загружено из git ✓" : "git недоступен — показан локальный кеш", !ok);
    });
  } else {
    setDataStatus("Загрузка из репозитория…", false);
    seedFromRepo().then((seeded) => {
      render();
      setDataStatus(seeded ? "Загружено из tasks.json" : "Готово к работе", false);
    });
  }
})();
