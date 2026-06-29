// Cloudflare Worker: читает и пишет tasks.json в GitHub-репозиторий.
// Токен GitHub хранится как секрет Worker'а (env.GITHUB_TOKEN), в браузер не попадает.

const GH_API = "https://api.github.com";

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/tasks") {
      return json({ error: "not found" }, 404, cors);
    }

    try {
      if (request.method === "GET") {
        const { tasks } = await readTasks(env);
        return json({ tasks }, 200, cors);
      }

      if (request.method === "PUT") {
        const body = await request.json();
        const tasks = Array.isArray(body) ? body : body.tasks;
        if (!Array.isArray(tasks)) {
          return json({ error: "expected { tasks: [...] }" }, 400, cors);
        }
        const result = await writeTasks(env, tasks);
        return json({ ok: true, commit: result.commit }, 200, cors);
      }

      return json({ error: "method not allowed" }, 405, cors);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500, cors);
    }
  },
};

function corsHeaders(env, request) {
  // env.ALLOWED_ORIGIN — список через запятую. localhost разрешаем всегда (для разработки).
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin") || "";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  let allowOrigin = allowed[0];
  if (allowed.includes("*")) allowOrigin = "*";
  else if (allowed.includes(origin) || isLocal) allowOrigin = origin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${(env.GITHUB_TOKEN || "").trim()}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "taskflow-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(env) {
  return `${GH_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${env.FILE_PATH}?ref=${env.BRANCH}`;
}

// Читаем файл из репозитория и возвращаем { tasks, sha }.
async function readTasks(env) {
  const res = await fetch(contentsUrl(env), { headers: ghHeaders(env) });
  if (res.status === 404) return { tasks: [], sha: null };
  if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const decoded = decodeBase64(data.content || "");
  let tasks = [];
  try {
    const parsed = JSON.parse(decoded);
    tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
  } catch {
    tasks = [];
  }
  return { tasks, sha: data.sha };
}

// Коммитим новый tasks.json (нужен текущий sha для перезаписи).
async function writeTasks(env, tasks) {
  const { sha } = await readTasks(env);
  const payload = JSON.stringify({ version: 1, tasks }, null, 2) + "\n";
  const body = {
    message: `tasks: обновление (${tasks.length} задач)`,
    content: encodeBase64(payload),
    branch: env.BRANCH,
    committer: { name: "taskflow-worker", email: "taskflow@users.noreply.github.com" },
  };
  if (sha) body.sha = sha;

  const putUrl = `${GH_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${env.FILE_PATH}`;
  const res = await fetch(putUrl, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { commit: data.commit && data.commit.sha };
}

// base64 <-> UTF-8 helpers (Worker runtime has atob/btoa over Latin-1).
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeBase64(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
