import { Command } from "@cliffy/command";
import { Checkbox, Confirm } from "@cliffy/prompt";
import { git, inGitRepo } from "../git.ts";
import { getGithubToken } from "../config.ts";

function parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const u = remoteUrl.trim();
  const m =
    u.match(/^git@github\.com:([^/]+)\/(.+?)(\.git)?$/) ||
    u.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(\.git)?$/) ||
    u.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

type PR = { number: number; title: string; url: string; isDraft: boolean; headRef: string; headLabel: string };

async function fetchOpenPRs(owner: string, repo: string, token: string): Promise<PR[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "gu-clean-branches",
      "Authorization": `Bearer ${token}`,
    },
  });
  if (!res.ok) return [];
  const prs = await res.json() as any[];
  return prs.map((p) => ({
    number: p.number,
    title: p.title ?? "",
    url: p.html_url ?? "",
    isDraft: !!p.draft,
    headRef: p?.head?.ref ?? "",
    headLabel: p?.head?.label ?? p?.head?.ref ?? "",
  }));
}

export const cleanBranchesCmd = new Command()
  .description("Interactively delete local branches (optionally disables ones with open PRs).")
  .option("--allow-pr", "Allow selecting branches that have an open PR (default: disabled).")
  .option("--no-prs", "Skip PR lookup (no network).")
  .option("--repo <ownerRepo:string>", "Override repo for PR lookup (owner/repo).")
  .option("--protected <names:string>", "Comma-separated protected branches (default: main,master,integration,develop).")
  .action(async (opts) => {
    if (!(await inGitRepo())) {
      console.error("Not inside a git repo.");
      Deno.exit(1);
    }

    const protectedSet = new Set(
      (opts.protected ?? "main,master,integration,develop")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
    );

    const current = (await git(["branch", "--show-current"])) || "";
    const all = (await git(["branch", "--format=%(refname:short)"]))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const candidates = all.filter((b) => !protectedSet.has(b) && b !== current);
    if (!candidates.length) {
      console.log("No deletable local branches found.");
      return;
    }

    // PR lookup (best-effort)
    const prByBranch = new Map<string, PR>();
    if (opts.prs) {
      const token = await getGithubToken();
      let ownerRepo: { owner: string; repo: string } | null = null;

      if (opts.repo) {
        const m = String(opts.repo).match(/^([^/]+)\/([^/]+)$/);
        if (m) ownerRepo = { owner: m[1], repo: m[2] };
      } else {
        try {
          const origin = await git(["remote", "get-url", "origin"]);
          ownerRepo = parseGitHubRepo(origin);
        } catch {
          ownerRepo = null;
        }
      }

      if (token && ownerRepo) {
        const prs = await fetchOpenPRs(ownerRepo.owner, ownerRepo.repo, token);
        const lower = new Map(candidates.map((b) => [b.toLowerCase(), b] as const));
        for (const pr of prs) {
          const match = lower.get(String(pr.headRef).toLowerCase());
          if (match) prByBranch.set(match, pr);
        }
      }
    }

    // Checkbox prompt (disabled items supported) :contentReference[oaicite:4]{index=4}
    const selections: string[] = await Checkbox.prompt({
      message: "Select local branches to delete",
      search: true,
      maxRows: Math.max(8, Math.min(candidates.length, (Deno.consoleSize()?.rows ?? 24) - 4)),
      options: candidates.map((b) => {
        const pr = prByBranch.get(b);
        const badge = pr ? (pr.isDraft ? "📝" : "🔗") : "  ";
        return {
          name: `${badge} ${b}`,
          value: b,
          hint: pr ? `#${pr.number} ${pr.title}` : "",
          disabled: pr && !opts.allowPr ? "open PR" : false,
        };
      }),
    });

    if (!selections?.length) {
      console.log("No branches selected. Exiting.");
      return;
    }

    console.log("\nSelected branches:");
    selections.forEach((b) => console.log(`- ${b}`));

    const ok = await Confirm.prompt("Delete these branches locally?");
    if (!ok) return console.log("Cancelled.");

    const failed: string[] = [];
    for (const b of selections) {
      try {
        await git(["branch", "-d", b]);
        console.log(`Deleted: ${b}`);
      } catch {
        failed.push(b);
      }
    }

    if (!failed.length) return console.log("\nDone.");

    console.log("\nNot deleted (likely not fully merged):");
    failed.forEach((b) => console.log(`- ${b}`));

    const force = await Confirm.prompt("Force delete these with -D?");
    if (!force) return console.log("Left remaining branches untouched.");

    for (const b of failed) {
      try {
        await git(["branch", "-D", b]);
        console.log(`Force deleted: ${b}`);
      } catch (e) {
        console.error(`Failed to force delete ${b}: ${String(e)}`);
      }
    }

    console.log("\nDone.");
  });
