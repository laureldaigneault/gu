import { Command } from "@cliffy/command";
import { Confirm, Input, Select } from "@cliffy/prompt";
import { git, inGitRepo } from "../git.ts";
import { getGithubToken } from "../config.ts";

type Repo = { owner: string; repo: string; remote: string; url: string };

function parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const u = remoteUrl.trim();
  const m =
    u.match(/^git@github\.com:([^/]+)\/(.+?)(\.git)?$/) ||
    u.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(\.git)?$/) ||
    u.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function tryGit(args: string[]): Promise<string | null> {
  try {
    return await git(args);
  } catch {
    return null;
  }
}

async function getRepoInfo(remoteName: string): Promise<Repo | null> {
  const url = (await tryGit(["remote", "get-url", remoteName]))?.trim();
  if (!url) return null;
  const info = parseGitHubRepo(url);
  if (!info) return null;
  return { ...info, remote: remoteName, url };
}

async function getBaseRepo(): Promise<Repo | null> {
  // PR target repo: prefer upstream (common in forks), else origin
  return (await getRepoInfo("upstream")) ?? (await getRepoInfo("origin"));
}

async function getHeadRepo(): Promise<Repo | null> {
  // Head repo: prefer origin (where you usually push your branch), else upstream
  return (await getRepoInfo("origin")) ?? (await getRepoInfo("upstream"));
}

function titleCaseFromSlug(slug: string): string {
  const s = slug
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!s) return "";
  return s
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function deriveTitleFromBranch(branch: string): { ticketPart: string; descTitle: string } {
  // Expected: <type>/<tickets>/<desc-slug>
  // Example: feature/HLTH-123-456-SWELL-888/a-little-potato
  const parts = branch.split("/").filter(Boolean);
  if (parts.length >= 3) {
    const ticketPart = parts[1]!;
    const desc = parts.slice(2).join("/"); // just in case desc contains slashes
    return { ticketPart, descTitle: titleCaseFromSlug(desc) };
  }
  // Fallback: no strict format
  return { ticketPart: branch, descTitle: "" };
}

async function listLocalBranches(): Promise<string[]> {
  const raw = await git(["branch", "--format=%(refname:short)"]);
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function chooseBaseBranch(defaults: string[], locals: string[], forced?: string): Promise<string> {
  if (forced) return forced;

  // Pick first existing default
  for (const d of defaults) {
    if (locals.includes(d)) return d;
  }

  // Otherwise ask
  return await Select.prompt({
    message: "Base branch for the PR",
    options: locals.map((b) => ({ name: b, value: b })),
    search: true,
  });
}

async function promptBulletList(): Promise<string> {
  console.log("\nPR description bullets (press Enter on empty line to finish):\n");

  const items: string[] = [];
  while (true) {
    const line = (await Input.prompt({
      message: items.length === 0 ? "•" : "• (next)",
      minLength: 0,
    })).trim();

    if (!line) break;
    items.push(line.replace(/^\s*[-*•]\s*/, "")); // normalize if user types "- ..."
  }

  if (!items.length) return "";

  return items.map((x) => `- ${x}`).join("\n");
}

async function createPullRequest(
  baseRepo: Repo,
  token: string,
  params: { title: string; body: string; head: string; base: string; draft?: boolean },
): Promise<{ url: string; number: number } | null> {
  const url = `https://api.github.com/repos/${baseRepo.owner}/${baseRepo.repo}/pulls`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "gu-pr",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body || undefined,
      head: params.head,
      base: params.base,
      draft: params.draft ?? false,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`❌ GitHub API error (${res.status}) creating PR.`);
    if (txt) console.error(txt.slice(0, 800));
    return null;
  }

  const json = await res.json() as any;
  return { url: json.html_url, number: json.number };
}

export const prCmd = new Command()
  .description("Create a GitHub PR for the current branch (title + bullets).")
  .option("--base <branch:string>", "Override the base branch for the PR (default: auto).")
  .option("--draft", "Create as a draft PR.")
  .option("--no-push", "Do not auto-push the branch if no upstream is set.")
  .action(async (opts) => {
    if (!(await inGitRepo())) {
      console.error("Not inside a git repo.");
      Deno.exit(1);
    }

    const token = await getGithubToken();
    if (!token) {
      console.error("No GitHub token configured.");
      console.error("Run: gu configure");
      Deno.exit(1);
    }

    const branch = (await git(["branch", "--show-current"])).trim();
    if (!branch) {
      console.error("Detached HEAD. Switch to a branch first.");
      Deno.exit(1);
    }

    const baseRepo = await getBaseRepo();
    const headRepo = await getHeadRepo();

    if (!baseRepo || !headRepo) {
      console.error("Could not determine GitHub repo from remotes (origin/upstream).");
      Deno.exit(1);
    }

    // If branch has no upstream, offer to push first (unless --no-push)
    const upstream = (await tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]))?.trim() ?? "";
    if (!upstream && opts.push !== false) {
      const okPush = await Confirm.prompt({
        message: `No upstream set for '${branch}'. Push it first to ${headRepo.remote}? (Enter = yes)`,
        default: true,
      });
      if (!okPush) {
        if (!opts.push) {
          // explicitly disabled push
        } else {
          console.log("Cancelled.");
          return;
        }
      } else {
        await git(["push", "-u", headRepo.remote, branch]);
      }
    }

    const locals = await listLocalBranches();
    const baseBranch = await chooseBaseBranch(
      ["develop", "main", "master", "integration"],
      locals,
      opts.base,
    );

    const { ticketPart, descTitle } = deriveTitleFromBranch(branch);
    const suggestedTitle = descTitle ? `${ticketPart}: ${descTitle}` : ticketPart;

    const titleInput = await Input.prompt({
      message: "PR title",
      default: suggestedTitle,
      minLength: 0,
    });
    const title = titleInput.trim() || suggestedTitle;

    const bullets = await promptBulletList();
    const body = bullets ? `${bullets}\n` : "";

    console.log("\n--- PR preview ---\n");
    console.log(`Repo:  ${baseRepo.owner}/${baseRepo.repo}`);
    console.log(`Base:  ${baseBranch}`);
    console.log(`Head:  ${headRepo.owner}:${branch}`);
    console.log(`Title: ${title}`);
    if (bullets) {
      console.log("\nBody:\n" + body);
    } else {
      console.log("\nBody: (empty)");
    }

    const ok = await Confirm.prompt({
      message: "Create PR? (Enter = yes)",
      default: true,
    });
    if (!ok) return console.log("Cancelled.");

    const created = await createPullRequest(baseRepo, token, {
      title,
      body,
      head: `${headRepo.owner}:${branch}`,
      base: baseBranch,
      draft: !!opts.draft,
    });

    if (!created) {
      Deno.exit(1);
    }

    console.log(`\n✅ PR created: #${created.number}`);
    console.log(created.url);
  });
