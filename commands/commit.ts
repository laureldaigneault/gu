import { Command } from "@cliffy/command";
import { Confirm, Input } from "@cliffy/prompt";
import { git, inGitRepo } from "../git.ts";

type ChangeKind = "A" | "M" | "D" | "R" | "C" | "U" | "?";

type ChangeEntry =
  | { kind: "A" | "M" | "D" | "U" | "?"; file: string }
  | { kind: "R" | "C"; from: string; to: string; score?: string };

/* ----------------------------- Pretty status ----------------------------- */

type StageCode = "A" | "M" | "D" | "R" | "C" | "U" | "?";

type UnifiedRow = {
  file: string;
  code: StageCode;
  detail?: string; // for rename/copy "from → to"
  alsoUnstaged?: boolean;
};

// Tiny ANSI helpers (no deps)
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

function colorFor(code: StageCode): string {
  if (code === "A") return ANSI.green;
  if (code === "M") return ANSI.blue;
  if (code === "D") return ANSI.red;
  if (code === "R" || code === "C") return ANSI.yellow;
  return ANSI.gray;
}

function pad2(s: string) {
  return s.length === 1 ? ` ${s}` : s;
}

function parsePorcelainWorkingTreeFiles(porcelain: string): Set<string> {
  // Collect files that have *unstaged* (working tree) changes.
  // Porcelain: XY <path>
  const set = new Set<string>();
  const lines = porcelain.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);

  for (const line of lines) {
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rest = line.slice(2).trim();

    // Untracked: "?? file"
    if (x === "?" && y === "?") {
      set.add(rest);
      continue;
    }

    // If working tree has changes, y != " "
    if (y !== " ") {
      set.add(rest);
    }
  }

  return set;
}
function entriesToUnifiedRows(entries: ChangeEntry[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];

  for (const e of entries) {
    if (e.kind === "R" || e.kind === "C") {
      rows.push({
        file: e.to,
        code: e.kind,
        detail: `${e.from} → ${e.to}`,
      });
      continue;
    }

    // ✅ Now TS knows e has `file`
    if ("file" in e) rows.push({ file: e.file, code: e.kind });
  }

  const order: Record<StageCode, number> = { A: 0, M: 1, D: 2, R: 3, C: 4, U: 5, "?": 6 };
  return rows.sort((a, b) => {
    const oa = order[a.code] ?? 99;
    const ob = order[b.code] ?? 99;
    if (oa !== ob) return oa - ob;
    return (a.detail ?? a.file).localeCompare(b.detail ?? b.file);
  });
}


function renderUnifiedStatus(rows: UnifiedRow[]): string {
  const lines: string[] = [];
  lines.push(`\nChanges (to be committed): ${rows.length}`);

  for (const r of rows) {
    const tag = `${colorFor(r.code)}[${r.code}]${ANSI.reset}`;
    const name = r.detail ? r.detail : r.file;
    const extra = r.alsoUnstaged ? ` ${ANSI.dim}(also unstaged)${ANSI.reset}` : "";
    lines.push(`  ${tag} ${name}${extra}`);
  }

  return lines.join("\n");
}

/* ------------------------- Parse + bucketize changes ------------------------- */

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

    // Renames/copies: "R100\told\tnew" or "C75\told\tnew"
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

/* --------------------- Subject + body generation helpers -------------------- */

function shortPath(p: string, max = 26): string {
  const s = p.trim();
  if (s.length <= max) return s;

  const parts = s.split("/").filter(Boolean);
  const last2 = parts.slice(-2).join("/");
  if (last2.length <= max) return last2;

  const base = parts[parts.length - 1] ?? s;
  if (base.length <= max) return base;

  return base.slice(0, Math.max(1, max - 1)) + "…";
}

function joinNice(items: string[], maxShow: number): { text: string; remaining: number } {
  const uniq = Array.from(new Set(items)).filter(Boolean);
  const shown = uniq.slice(0, maxShow);
  const remaining = Math.max(0, uniq.length - shown.length);

  if (shown.length === 0) return { text: "", remaining };
  if (shown.length === 1) return { text: shown[0]!, remaining };
  if (shown.length === 2) return { text: `${shown[0]} and ${shown[1]}`, remaining };

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

  const small = total <= 3;
  const maxShow = small ? 3 : 2;

  const parts: string[] = [];

  const added = actionPhrase("Added", b.added, maxShow);
  const modified = actionPhrase("Updated", b.modified, maxShow);
  const deleted = actionPhrase("Deleted", b.deleted, maxShow);

  const onlyRenames = total > 0 && b.renamed.length === total;
  const onlyCopies = total > 0 && b.copied.length === total;

  const renamed = (small || onlyRenames) ? actionPhrase("Renamed", b.renamed, maxShow) : null;
  const copied = (small || onlyCopies) ? actionPhrase("Copied", b.copied, maxShow) : null;

  if (added) parts.push(added);
  if (modified) parts.push(modified);
  if (deleted) parts.push(deleted);
  if (renamed) parts.push(renamed);
  if (copied) parts.push(copied);

  if (parts.length === 0) return total === 1 ? "Updated 1 file" : `Updated ${total} files`;

  if (!small && total > 6) return `${parts.join("; ")} (${total} files)`;

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
  const LIMIT_ADDED = 12;
  const LIMIT_MODIFIED = 14;
  const LIMIT_DELETED = 8;
  const LIMIT_OTHER = 6;

  const lines: string[] = [];
  lines.push(
    ...formatSection("Added", b.added, LIMIT_ADDED),
    ...formatSection("Modified", b.modified, LIMIT_MODIFIED),
    ...formatSection("Deleted", b.deleted, LIMIT_DELETED),
    ...formatSection("Renamed", b.renamed, LIMIT_OTHER),
    ...formatSection("Copied", b.copied, LIMIT_OTHER),
    ...formatSection("Other", b.other, LIMIT_OTHER),
  );

  if (!lines.length) return "Files:\n- (no file list available)";
  return lines.join("\n");
}

/* --------------------------------- Command -------------------------------- */

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

    const branch = (await git(["branch", "--show-current"])).trim() || "(detached)";
    const porcelain = await git(["status", "--porcelain"]);
    if (!porcelain.trim()) {
      console.log("No changes detected. Nothing to commit.");
      return;
    }

    console.log(`\n📍 On branch: ${branch}`);

    // Capture which files still have working-tree changes (for the inline marker)
    const unstagedFiles = parsePorcelainWorkingTreeFiles(porcelain);

    await git(["add", "--all"]);

    const nameStatus = await git(["diff", "--cached", "--name-status"]);
    const entries = parseNameStatus(nameStatus);
    if (!entries.length) {
      console.log("No staged changes after git add --all. Nothing to commit.");
      return;
    }

    // Unified colored “status”
    const rows = entriesToUnifiedRows(entries).map((r) => ({
      ...r,
      alsoUnstaged: unstagedFiles.has(r.file),
    }));
    console.log(renderUnifiedStatus(rows));
    console.log("\n");

    const buckets = bucketize(entries);
    const suggested = buildSuggestedSubject(buckets);
    const body = buildBody(buckets);

    const subjectInput = await Input.prompt({
      message: "Commit summary (one line)",
      default: suggested,
      minLength: 0,
      validate: (v) => {
        const s = String(v ?? "").trim();
        if (s.length > 72) return "Try to keep it under ~72 characters.";
        return true;
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
