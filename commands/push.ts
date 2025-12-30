import { Command } from "@cliffy/command";
import { Confirm } from "@cliffy/prompt";
import { git, inGitRepo } from "../git.ts";

const DEFAULT_PROTECTED = new Set(["main", "master", "develop", "integration", "release"]);

async function tryGit(args: string[]): Promise<string | null> {
  try {
    return await git(args);
  } catch {
    return null;
  }
}

function parseUpstream(up: string): { remote: string; branch: string } | null {
  // "origin/feature/foo"
  const m = up.trim().match(/^([^/]+)\/(.+)$/);
  return m ? { remote: m[1], branch: m[2] } : null;
}

function isProtectedBranch(branch: string): boolean {
  const b = branch.trim();
  if (!b) return false;
  if (DEFAULT_PROTECTED.has(b)) return true;
  // also treat "release/x.y.z" as protected-ish
  if (b.startsWith("release/")) return true;
  return false;
}

export const pushCmd = new Command()
  .description("Show commits that will be pushed, then push (Enter = push).")
  .action(async () => {
    if (!(await inGitRepo())) {
      console.error("Not inside a git repo.");
      Deno.exit(1);
    }

    const branch = (await git(["branch", "--show-current"])).trim();
    if (!branch) {
      console.error("Detached HEAD. Not sure what to push.");
      Deno.exit(1);
    }

    const upstream = (await tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]))?.trim() ?? "";
    const upstreamParsed = upstream ? parseUpstream(upstream) : null;

    // If no upstream configured, default to origin/<branch>
    const targetRemote = upstreamParsed?.remote ?? "origin";
    const targetBranch = upstreamParsed?.branch ?? branch;
    const target = `${targetRemote}/${targetBranch}`;

    console.log(`\nCurrent branch: ${branch}`);
    console.log(`Push target:     ${target}${upstream ? ` (upstream: ${upstream})` : " (no upstream set)"}`);

    if (isProtectedBranch(targetBranch)) {
      console.log("\n⚠️  Warning: You are pushing to a protected-ish branch:");
      console.log(`   ${targetBranch}`);
      console.log("   Make sure this is what you intended.\n");
    }

    if (!upstream) {
      // No upstream: show recent commits (best effort)
      const recent = (await git(["log", "--oneline", "--max-count=20", "HEAD"])).trim();
      console.log("\nRecent commits on this branch:\n");
      console.log(recent || "(none)");

      const ok = await Confirm.prompt({
        message: `Press Enter to push with upstream (-u ${targetRemote} ${branch})`,
        default: true,
      });
      if (!ok) return console.log("Cancelled.");

      await git(["push", "-u", targetRemote, branch]);
      console.log("Done.");
      return;
    }

    const aheadCountStr = (await git(["rev-list", "--count", `${upstream}..HEAD`])).trim();
    const aheadCount = Number(aheadCountStr || "0");

    if (!aheadCount) {
      console.log(`\nNothing to push. '${branch}' is up to date with ${upstream}.`);
      return;
    }

    const list = (await git(["log", "--oneline", "--max-count=30", `${upstream}..HEAD`])).trim();

    console.log(`\nCommits to be pushed (${aheadCount}):\n`);
    console.log(list || "(none)");
    if (aheadCount > 30) console.log(`\n…showing latest 30 of ${aheadCount} commits`);

    const ok = await Confirm.prompt({
      message: `Press Enter to push to ${target}`,
      default: true,
    });
    if (!ok) return console.log("Cancelled.");

    await git(["push"]);
    console.log("Done.");
  });
