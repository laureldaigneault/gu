import { Command } from "@cliffy/command";
import { Select } from "@cliffy/prompt";

import { cleanBranchesCmd } from "./commands/clean_branches.ts";
import { commitCmd } from "./commands/commit.ts";
import { configureCmd } from "./commands/configure.ts";
import { pushCmd } from "./commands/push.ts";
import { branchesCmd } from "./commands/branches.ts";
import { newCmd } from "./commands/new.ts";
import { prCmd } from "./commands/pr.ts";

type MenuItem = {
  cmd: string;
  label: string;
  description: string;
};

const MENU: MenuItem[] = [
  { cmd: "configure", label: "configure", description: "Set tokens/keys (GitHub, OpenAI, etc.)" },
  { cmd: "clean-branches", label: "clean-branches", description: "Interactively delete local branches (PR-aware)" },
  { cmd: "branches", label: "branches", description: "Pick a local branch to checkout" },
  { cmd: "new", label: "new", description: "Create a new branch (guided)" },
  { cmd: "commit", label: "commit", description: "Stage all + create a commit with a generated body" },
  { cmd: "push", label: "push", description: "Show commits that will be pushed, then push" },
  { cmd: "pr", label: "pr", description: "Create a GitHub PR for current branch" },
];

const app = new Command()
  .name("gu")
  .version("0.3.0")
  .description("Git utilities");

const menuCmd = new Command()
  .description("Interactive menu for gu commands.")
  .action(async () => {
    const picked = await Select.prompt({
      message: "What do you want to do?",
      options: [
        ...MENU.map((m) => ({
          name: `${m.label} — ${m.description}`,
          value: m.cmd,
        })),
        { name: "help — show CLI help", value: "__help__" },
        { name: "exit", value: "__exit__" },
      ],
      search: true,
    });

    if (picked === "__exit__") return;

    if (picked === "__help__") {
      await app.parse(["--help"]);
      return;
    }

    // Run the chosen command as if user typed: gu <cmd>
    await app.parse([picked]);
  });

// Register all commands (including menu)
app
  .command("menu", menuCmd)
  .command("configure", configureCmd)
  .command("clean-branches", cleanBranchesCmd)
  .command("branches", branchesCmd)
  .command("new", newCmd)
  .command("commit", commitCmd)
  .command("push", pushCmd)
  .command("pr", prCmd);

// Default behavior: `gu` (no args) => `gu menu`
await app.parse(Deno.args.length === 0 ? ["menu"] : Deno.args);
