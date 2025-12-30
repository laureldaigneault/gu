import { Command } from "@cliffy/command";
import { Input, Select, Confirm } from "@cliffy/prompt";
import { git, inGitRepo } from "../git.ts";

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseTickets(input: string): string[] {
  const parts = input
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.filter((t) => /^[A-Z]+-\d+$/.test(t));
}

function compressTickets(tickets: string[]): string {
  const uniq = Array.from(new Set(tickets.map((t) => t.trim()).filter(Boolean)));

  const groups = new Map<string, number[]>();

  for (const t of uniq) {
    const [prefix, numStr] = t.split("-");
    const n = Number(numStr);
    if (!prefix || !Number.isFinite(n)) continue;

    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(n);
  }

  const pieces: string[] = [];
  for (const prefix of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    const nums = (groups.get(prefix) ?? []).slice().sort((a, b) => a - b);
    const uniqNums = Array.from(new Set(nums)); // just in case
    if (uniqNums.length) pieces.push(`${prefix}-${uniqNums.join("-")}`);
  }

  return pieces.length ? pieces.join("-") : uniq.join("-");
}

async function branchExists(name: string): Promise<boolean> {
  try {
    await git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}

async function listLocalBranches(): Promise<string[]> {
  const raw = await git(["branch", "--format=%(refname:short)"]);
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export const newCmd = new Command()
  .description("Create a new branch (guided).")
  .action(async () => {
    if (!(await inGitRepo())) {
      console.error("Not inside a git repo.");
      Deno.exit(1);
    }

    const current = (await git(["branch", "--show-current"])).trim();
    const locals = await listLocalBranches();

    const commonBases = ["develop", "main", "master", "integration"];
    const availableCommon = commonBases.filter((b) => locals.includes(b));

    const base = await Select.prompt({
      message: "Base branch",
      options: [
        ...(current ? [{ name: `current (${current})`, value: current }] : []),
        ...availableCommon
          .filter((b) => b !== current)
          .map((b) => ({ name: b, value: b })),
      ],
    });

    const type = await Select.prompt({
      message: "Branch type",
      options: [
        { name: "feature", value: "feature" },
        { name: "hotfix", value: "hotfix" },
      ],
    });

    const ticketsRaw = await Input.prompt({
      message: "Tickets (space/comma-separated, e.g. HLTH-123 HLTH-456 SWELL-1000)",
      validate: (v) => {
        const t = parseTickets(String(v ?? ""));
        return t.length ? true : "Enter at least one ticket like HLTH-123.";
      },
    });

    const tickets = parseTickets(ticketsRaw);
    const ticketPart = compressTickets(tickets);

    const desc = await Input.prompt({
      message: "Short description (one line)",
      validate: (v) => (String(v ?? "").trim() ? true : "Enter a short description."),
    });

    const slug = slugify(desc);
    if (!slug) {
      console.error("Could not create a slug from that description.");
      Deno.exit(1);
    }

    const branch = `${type}/${ticketPart}/${slug}`;

    console.log("\nBase branch:     " + base);
    console.log("Proposed branch: " + branch);

    if (await branchExists(branch)) {
      const ok = await Confirm.prompt({
        message: "Branch already exists locally. Checkout it instead? (Enter = yes)",
        default: true,
      });
      if (!ok) return console.log("Cancelled.");
      await git(["checkout", branch]);
      console.log(`Checked out '${branch}'.`);
      return;
    }

    const ok = await Confirm.prompt({
      message: "Create and checkout this branch? (Enter = yes)",
      default: true,
    });
    if (!ok) return console.log("Cancelled.");

    // Ensure we're on base (only if different)
    if (base && base !== current) {
      await git(["checkout", base]);
    }

    // Create from base
    await git(["checkout", "-b", branch]);
    console.log(`Created and checked out '${branch}'.`);
  });
