/* TaskFlow — простой менеджер задач с прогресс-баром.
 * Данные хранятся в localStorage, без бэкенда. */
(function () {
  "use strict";

  const STORAGE_KEY = "taskflow.tasks.v1";
  const THEME_KEY = "taskflow.theme";

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

  // --- Persistence ---
  function load() {
    try {
      tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      tasks = [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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
  render();
})();
