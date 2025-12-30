import { Command } from "@cliffy/command";
import { Select } from "@cliffy/prompt";
import { git, inGitRepo } from "../git.ts";

export const branchesCmd = new Command()
  .description("Pick a local branch to checkout.")
  .action(async () => {
    if (!(await inGitRepo())) {
      console.error("Not inside a git repo.");
      Deno.exit(1);
    }

    const current = (await git(["branch", "--show-current"])).trim();

    const raw = await git(["branch", "--format=%(refname:short)"]);
    const branches = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!branches.length) {
      console.log("No local branches found.");
      return;
    }

    // Current first (nice UX)
    const ordered = current ? [current, ...branches.filter((b) => b !== current)] : branches;

    const picked = await Select.prompt({
      message: "Checkout which branch?",
      options: ordered.map((b) => ({
        name: b === current ? `* ${b}` : `  ${b}`,
        value: b,
      })),
      search: true,
    });

    if (!picked) return;

    if (picked === current) {
      console.log(`Already on '${current}'.`);
      return;
    }

    await git(["checkout", picked]);
    console.log(`Checked out '${picked}'.`);
  });
