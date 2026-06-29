# TaskFlow

Простой и быстрый менеджер задач с прогресс-баром. Данные хранятся в git: Cloudflare Worker автоматически коммитит `tasks.json` в репозиторий.

## Возможности

- ✅ Создание задач с приоритетом (низкий / средний / высокий)
- 📊 Прогресс-бар, который обновляется по мере выполнения задач
- 🔍 Фильтры: все / активные / выполненные
- 🗑️ Удаление задач и очистка выполненных
- 🌙 Светлая и тёмная тема (запоминается)
- ☁️ Автосохранение в git через Cloudflare Worker

## Хранение данных в git

Источник правды — файл [`tasks.json`](tasks.json) в репозитории. Запись идёт через [Cloudflare Worker](worker/) (`worker/src/index.js`):

- При загрузке приложение тянет задачи из Worker'а (`GET /api/tasks`), который читает `tasks.json` из репозитория.
- При любом изменении задачи через ~2 секунды коммитятся в репозиторий (`PUT /api/tasks` → GitHub Contents API). Каждое изменение = коммит от автора `taskflow-worker`.
- `localStorage` используется как офлайн-кеш; кнопки **«Экспорт»/«Импорт»** остаются резервным способом переноса данных файлом.

### Архитектура

```
Браузер (GitHub Pages)
   │  GET/PUT /api/tasks
   ▼
Cloudflare Worker  ── GITHUB_TOKEN (секрет Worker'а) ──▶  GitHub API → tasks.json в репо
```

Токен GitHub хранится секретом Worker'а и в браузер не попадает.

### Настройка Worker'а

```bash
cd worker
wrangler deploy                       # публикация
wrangler secret put GITHUB_TOKEN      # fine-grained PAT с Contents: Read and write на этот репо
```

Параметры репозитория (owner/name/branch) и разрешённые origin'ы заданы в [`worker/wrangler.toml`](worker/wrangler.toml). URL задеплоенного Worker'а прописан в [`app.js`](app.js) (можно переопределить через `localStorage["taskflow.workerUrl"]`).

## Запуск локально

Это статичный сайт — никакой сборки не нужно. Откройте `index.html` в браузере или запустите локальный сервер:

```bash
python -m http.server 8000
# затем откройте http://localhost:8000
```

## Технологии

Чистый HTML + CSS + JavaScript (ES6), без зависимостей.

## Деплой

Сайт развёрнут через GitHub Pages из ветки `main`.
