import { Command } from "@cliffy/command";
import { Confirm, Input } from "@cliffy/prompt";
import { loadDotenv } from "../env.ts";
import { git, inGitRepo } from "../git.ts";

function formatNameStatus(nameStatusText: string) {
  const lines = nameStatusText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(/\t+/);
    const code = parts[0];

    if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
      const kind = code[0];
      return `${kind}  ${parts[1]} -> ${parts[2]}`;
    }

    const file = parts[1] || parts[0];
    const pretty =
      code === "M" ? `M  ${file}` :
      code === "A" ? `A  ${file}` :
      code === "D" ? `D  ${file}` :
      `?  ${file}`;
    return pretty;
  });
}

export const commitCmd = new Command()
  .description("Stage all changes and create a commit with an auto-generated body.")
  .option("--no-verify", "Pass --no-verify to git commit.")
  .option("--amend", "Pass --amend to git commit.")
  .option("--signoff", "Pass --signoff to git commit.")
  .action(async (opts) => {
    await loadDotenv();

    if (!(await inGitRepo())) {
      console.error("Not inside a git repo.");
      Deno.exit(1);
    }

    const porcelain = await git(["status", "--porcelain"]);
    if (!porcelain.trim()) {
      console.log("No changes detected. Nothing to commit.");
      return;
    }

    await git(["add", "--all"]);

    const nameStatus = await git(["diff", "--cached", "--name-status"]);
    const changes = formatNameStatus(nameStatus);
    if (!changes.length) {
      console.log("No staged changes after git add --all. Nothing to commit.");
      return;
    }

    const stat = await git(["diff", "--cached", "--stat"]);

    const subject = await Input.prompt({
      message: "Commit summary (one line)",
      validate: (v) => {
        const s = String(v ?? "").trim();
        if (!s) return "Please enter a short summary.";
        if (s.length > 72) return "Try to keep it under ~72 characters.";
        return true;
      },
    });

    const bodyLines = [
      "Changes:",
      ...changes.map((c) => `- ${c}`),
      "",
      "Stats:",
      ...stat.split(/\r?\n/).map((l) => `  ${l}`),
    ];

    console.log("\n--- Commit message preview ---\n");
    console.log(subject);
    console.log("");
    console.log(bodyLines.join("\n"));

    const ok = await Confirm.prompt("Create commit with this message?");
    if (!ok) return console.log("Cancelled.");

    const args = ["commit", "-m", subject, "-m", bodyLines.join("\n")];
    if (!opts.verify) args.push("--no-verify");
    if (opts.amend) args.push("--amend");
    if (opts.signoff) args.push("--signoff");

    // Note: this uses -m (no temp file), so no --allow-write needed.
    await git(args);
    console.log("\nDone.");
  });
