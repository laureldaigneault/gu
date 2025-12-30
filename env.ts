// Tiny .env loader (loads .env.local then .env, without overwriting existing env vars)
export async function loadDotenv(cwd = Deno.cwd()) {
    await loadOne(`${cwd}/.env.local`);
    await loadOne(`${cwd}/.env`);
  }
  
  async function loadOne(path: string) {
    try {
      const txt = await Deno.readTextFile(path);
      for (const line of txt.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i <= 0) continue;
  
        const key = t.slice(0, i).trim();
        let val = t.slice(i + 1).trim();
        val = val.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  
        if (Deno.env.get(key) === undefined) Deno.env.set(key, val);
      }
    } catch {
      // ignore missing files
    }
  }
  