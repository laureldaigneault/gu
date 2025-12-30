// config.ts
const td = new TextDecoder();
const te = new TextEncoder();

export type GuConfig = {
  githubToken?: string;
  openaiApiKey?: string;
};

function homeDir(): string {
  const home = Deno.env.get("HOME");
  if (home) return home;
  const userProfile = Deno.env.get("USERPROFILE");
  if (userProfile) return userProfile;
  throw new Error("Cannot determine home directory (HOME/USERPROFILE not set).");
}

export function configDir(): string {
  const xdg = Deno.env.get("XDG_CONFIG_HOME");
  if (xdg) return `${xdg}/gu`;

  const home = homeDir();
  if (Deno.build.os === "darwin") {
    return `${home}/Library/Application Support/gu`;
  }
  return `${home}/.config/gu`;
}

export function configPath(): string {
  return `${configDir()}/config.json`;
}

export async function readConfig(): Promise<GuConfig> {
  try {
    const bytes = await Deno.readFile(configPath());
    const raw = td.decode(bytes).trim();
    if (!raw) return {};
    return JSON.parse(raw) as GuConfig;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {};
    throw e;
  }
}

export async function writeConfig(cfg: GuConfig): Promise<void> {
  await Deno.mkdir(configDir(), { recursive: true });
  await Deno.writeFile(configPath(), te.encode(JSON.stringify(cfg, null, 2) + "\n"));
}

// -------- GitHub token --------

export async function setGithubToken(token: string): Promise<void> {
  const cfg = await readConfig();
  cfg.githubToken = token;
  await writeConfig(cfg);
}

export async function clearGithubToken(): Promise<void> {
  const cfg = await readConfig();
  delete cfg.githubToken;
  await writeConfig(cfg);
}

export async function getGithubToken(): Promise<string | null> {
  const cfg = await readConfig();
  return cfg.githubToken?.trim() ? cfg.githubToken.trim() : null;
}

// -------- OpenAI API key --------

export async function setOpenAIApiKey(key: string): Promise<void> {
  const cfg = await readConfig();
  cfg.openaiApiKey = key;
  await writeConfig(cfg);
}

export async function clearOpenAIApiKey(): Promise<void> {
  const cfg = await readConfig();
  delete cfg.openaiApiKey;
  await writeConfig(cfg);
}

export async function getOpenAIApiKey(): Promise<string | null> {
  const cfg = await readConfig();
  return cfg.openaiApiKey?.trim() ? cfg.openaiApiKey.trim() : null;
}
