// GitHub REST adapter for the browser. The ONLY remote the app talks to (see
// the CSP in index.html). Same header set the retired local fetchers used.
// Reads everything; writes exactly ONE kind of file: Intent prompts into
// gradebook/intents/ (putIntent below). Grades, notes, publish flags and
// everything else are still only ever written by Claude Code executing those
// intents locally - keep it that way.
let TOKEN = "";
export const setToken = t => { TOKEN = t || ""; };

export class AuthError extends Error {}

// in-memory ETag cache: revalidated 304s are free against the rate limit
const CACHE = new Map(); // url|accept -> { etag, body }
export const rate = { remaining: null, limit: null };

async function req(url, accept, parse) {
  const key = url + "|" + accept;
  const hit = CACHE.get(key);
  const headers = {
    Authorization: "Bearer " + TOKEN,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (hit && hit.etag) headers["If-None-Match"] = hit.etag;
  const r = await fetch("https://api.github.com" + url, { headers });
  if (r.headers.has("x-ratelimit-remaining")) {
    rate.remaining = +r.headers.get("x-ratelimit-remaining");
    rate.limit = +r.headers.get("x-ratelimit-limit");
  }
  if (r.status === 304 && hit) return hit.body;
  if (r.status === 401) throw new AuthError("GitHub rejected the token (401). Check it in Settings.");
  if (!r.ok) return null;
  const body = await parse(r);
  const etag = r.headers.get("etag");
  if (etag) CACHE.set(key, { etag, body });
  return body;
}

export const ghJSON = url => req(url, "application/vnd.github+json", r => r.json());
export const ghText = url => req(url, "application/vnd.github.raw", r => r.text());
export const ghBuf  = url => req(url, "application/vnd.github.raw", r => r.arrayBuffer());

// authenticated image fetch -> object URL (a bare <img src> can't send the token)
const BLOBURLS = new Map();
export async function ghBlobURL(url, mime) {
  if (BLOBURLS.has(url)) return BLOBURLS.get(url);
  const buf = await ghBuf(url);
  if (!buf) return null;
  const u = URL.createObjectURL(new Blob([buf], mime ? { type: mime } : undefined));
  BLOBURLS.set(url, u);
  return u;
}

// UTF-8 -> base64 (btoa alone chokes on non-latin1)
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// The single write path: file an Intent prompt under gradebook/intents/ on the
// teacher repo. New files only (no sha handling on purpose - an intent is never
// edited, only executed + archived by Claude Code).
export async function putIntent(org, repo, path, content, message) {
  const r = await fetch(`https://api.github.com/repos/${org}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, content: b64(content) }),
  });
  if (r.status === 401) throw new AuthError("GitHub rejected the token (401). Check it in Settings.");
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`GitHub ${r.status}: ${j.message || "write failed"}${r.status === 403 ? " (does the token have Contents: Read and write?)" : ""}`);
  }
  return r.json();
}

// concurrency pool (same shape as the retired local fetchers)
export async function pool(items, n, fn) {
  const q = items.slice();
  const runners = Array.from({ length: n }, async () => { while (q.length) { await fn(q.shift()); } });
  await Promise.all(runners);
}
