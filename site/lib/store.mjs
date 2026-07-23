// App config in this browser's localStorage: teacher repo URLs + the read-only
// GitHub token. Review decisions live under their own long-standing key
// (hau-grade-decisions-v1) in app.mjs, byte-compatible with the retired local
// dashboard so exported backups import cleanly.
const CKEY = "grader-ui-config-v1";

export function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CKEY) || "null");
    if (!c || !Array.isArray(c.repos) || !c.githubToken) return null;
    return c;
  } catch { return null; }
}

export function saveConfig(c) {
  localStorage.setItem(CKEY, JSON.stringify(c));
}

export function clearConfig() {
  localStorage.removeItem(CKEY);
}
