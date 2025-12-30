import { Command } from "@cliffy/command";
import { Confirm, Input } from "@cliffy/prompt";
import { git, inGitRepo } from "../git.ts";

type ChangeKind = "A" | "M" | "D" | "R" | "C" | "U" | "?";

type ChangeEntry =
  | { kind: "A" | "M" | "D" | "U" | "?"; file: string }
  | { kind: "R" | "C"; from: string; to: string; score?: string };

function parseNameStatus(nameStatusText: string): ChangeEntry[] {
  const lines = nameStatusText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: ChangeEntry[] = [];

  for (const line of lines) {
    const parts = line.split(/\t+/).filter(Boolean);
    if (!parts.length) continue;

    const rawCode = parts[0] ?? "";
    const kind = (rawCode[0] ?? "?") as ChangeKind;

    // Renames/copies come like: "R100\told\tnew" or "C75\told\tnew"
    if ((kind === "R" || kind === "C") && parts.length >= 3) {
      out.push({
        kind,
        from: parts[1]!,
        to: parts[2]!,
        score: rawCode.slice(1) || undefined,
      });
      continue;
    }

    const file = parts[1] || parts[0]; // fallback
    out.push({ kind: (kind || "?") as any, file });
  }

  return out;
}

function bucketize(entries: ChangeEntry[]) {
  const buckets = {
    added: [] as string[],
    modified: [] as string[],
    deleted: [] as string[],
    renamed: [] as string[],
    copied: [] as string[],
    other: [] as string[],
  };

  for (const e of entries) {
    if (e.kind === "A") buckets.added.push(e.file);
    else if (e.kind === "M") buckets.modified.push(e.file);
    else if (e.kind === "D") buckets.deleted.push(e.file);
    else if (e.kind === "R") buckets.renamed.push(`${e.from} → ${e.to}`);
    else if (e.kind === "C") buckets.copied.push(`${e.from} → ${e.to}`);
    else buckets.other.push("file" in e ? e.file : `${e.from} → ${e.to}`);
  }

  // Stable-ish ordering that feels nice in commit messages
  const sort = (a: string[]) => a.slice().sort((x, y) => x.localeCompare(y));
  return {
    added: sort(buckets.added),
    modified: sort(buckets.modified),
    deleted: sort(buckets.deleted),
    renamed: sort(buckets.renamed),
    copied: sort(buckets.copied),
    other: sort(buckets.other),
  };
}
function shortPath(p: string, max = 26): string {
  const s = p.trim();
  if (s.length <= max) return s;

  // Prefer last 2 segments: foo/bar/baz.ts -> bar/baz.ts
  const parts = s.split("/").filter(Boolean);
  const last2 = parts.slice(-2).join("/");
  if (last2.length <= max) return last2;

  // Else: basename with ellipsis
  const base = parts[parts.length - 1] ?? s;
  if (base.length <= max) return base;

  // Hard truncate
  return base.slice(0, Math.max(1, max - 1)) + "…";
}
function joinNice(items: string[], maxShow: number): { text: string; remaining: number } {
  const uniq = Array.from(new Set(items)).filter(Boolean);
  const shown = uniq.slice(0, maxShow);
  const remaining = Math.max(0, uniq.length - shown.length);

  if (shown.length === 0) return { text: "", remaining };
  if (shown.length === 1) return { text: shown[0]!, remaining };
  if (shown.length === 2) return { text: `${shown[0]} and ${shown[1]}`, remaining };

  // 3+: "A, B, and C"
  return {
    text: `${shown.slice(0, -1).join(", ")}, and ${shown[shown.length - 1]}`,
    remaining,
  };
}

function actionPhrase(verb: string, files: string[], maxShow: number): string | null {
  const shortened = Array.from(new Set(files)).map((f) => shortPath(f));
  const { text, remaining } = joinNice(shortened, maxShow);
  if (!text) return null;
  return remaining > 0 ? `${verb} ${text} (+${remaining} more)` : `${verb} ${text}`;
}

function buildSuggestedSubject(b: ReturnType<typeof bucketize>): string {
  const total =
    b.added.length +
    b.modified.length +
    b.deleted.length +
    b.renamed.length +
    b.copied.length +
    b.other.length;

  // For small change sets, be very explicit.
  // For bigger ones, still show *some* detail but keep it short.
  const small = total <= 3;
  const maxShow = small ? 3 : 2;

  const parts: string[] = [];

  // Priority order: Added + Modified first (your preference), then Deleted, etc.
  const added = actionPhrase("Added", b.added, maxShow);
  const modified = actionPhrase("Updated", b.modified, maxShow);
  const deleted = actionPhrase("Deleted", b.deleted, maxShow);

  // Renames/Copies are often noisy—include only when small or when it's the only change type.
  const onlyRenames = total > 0 && b.renamed.length === total;
  const onlyCopies = total > 0 && b.copied.length === total;

  const renamed = (small || onlyRenames) ? actionPhrase("Renamed", b.renamed, maxShow) : null;
  const copied = (small || onlyCopies) ? actionPhrase("Copied", b.copied, maxShow) : null;

  if (added) parts.push(added);
  if (modified) parts.push(modified);
  if (deleted) parts.push(deleted);
  if (renamed) parts.push(renamed);
  if (copied) parts.push(copied);

  // If we somehow have nothing (shouldn't happen), fallback:
  if (parts.length === 0) {
    if (total === 1) return "Updated 1 file";
    return `Updated ${total} files`;
  }

  // If it’s a big mixed set, add a tiny count suffix so it’s honest.
  // Example: "Added X and updated Y (12 files)"
  if (!small && total > 6) {
    return `${parts.join("; ")} (${total} files)`;
  }

  // Normal case: "Added X; Updated Y; Deleted Z"
  return parts.join("; ");
}


function formatSection(title: string, items: string[], limit: number): string[] {
  if (!items.length) return [];
  const shown = items.slice(0, limit);
  const remaining = items.length - shown.length;

  const lines = [
    `${title}:`,
    ...shown.map((x) => `- ${x}`),
  ];
  if (remaining > 0) lines.push(`- …and ${remaining} more`);
  return lines;
}

function buildBody(b: ReturnType<typeof bucketize>): string {
  // Keep it readable and not too long
  const LIMIT_ADDED = 12;
  const LIMIT_MODIFIED = 14;
  const LIMIT_DELETED = 8;
  const LIMIT_OTHER = 6;

  const lines: string[] = [];

  // Prioritize new + edited first (as requested)
  lines.push(
    ...formatSection("Added", b.added, LIMIT_ADDED),
    ...formatSection("Modified", b.modified, LIMIT_MODIFIED),
    ...formatSection("Deleted", b.deleted, LIMIT_DELETED),
    ...formatSection("Renamed", b.renamed, LIMIT_OTHER),
    ...formatSection("Copied", b.copied, LIMIT_OTHER),
    ...formatSection("Other", b.other, LIMIT_OTHER),
  );

  // Make sure it's never empty (shouldn't happen, but safe)
  if (!lines.length) return "Files:\n- (no file list available)";

  return lines.join("\n");
}

export const commitCmd = new Command()
  .description("Stage all changes and create a commit with an auto-generated body.")
  .option("--no-verify", "Pass --no-verify to git commit.")
  .option("--amend", "Pass --amend to git commit.")
  .option("--signoff", "Pass --signoff to git commit.")
  .action(async (opts) => {
    if (!(await inGitRepo())) {
      console.error("Not inside a git repo.");
      Deno.exit(1);
    }

    const porcelain = await git(["status", "--porcelain"]);
    if (!porcelain.trim()) {
      console.log("No changes detected. Nothing to commit.");
      return;
    }

    // Stage everything first
    await git(["add", "--all"]);

    // Build categorized file list from staged changes
    const nameStatus = await git(["diff", "--cached", "--name-status"]);
    const entries = parseNameStatus(nameStatus);
    if (!entries.length) {
      console.log("No staged changes after git add --all. Nothing to commit.");
      return;
    }

    const buckets = bucketize(entries);
    const suggested = buildSuggestedSubject(buckets);
    const body = buildBody(buckets);

    const subjectInput = await Input.prompt({
      message: "Commit summary (one line)",
      default: suggested,      // shown as placeholder/prefill
      minLength: 0,            // allow empty submit
      validate: (v) => {
        const s = String(v ?? "").trim();
        if (s.length > 72) return "Try to keep it under ~72 characters.";
        return true;           // allow empty
      },
    });
    
    const subject = subjectInput.trim() || suggested;

    console.log("\n--- Commit message preview ---\n");
    console.log(subject.trim());
    console.log("");
    console.log(body);

    const ok = await Confirm.prompt({
      message: "Create commit with this message?",
      default: true, // Enter = yes
    });
    
    if (!ok) return console.log("Cancelled.");

    const args = ["commit", "-m", subject, "-m", body];
    if (!opts.verify) args.push("--no-verify");
    if (opts.amend) args.push("--amend");
    if (opts.signoff) args.push("--signoff");

    await git(args);
    console.log("\nDone.");
  });
