const td = new TextDecoder();

export async function git(args: string[]): Promise<string> {
  const cmd = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(td.decode(stderr).trim() || `git ${args.join(" ")} failed`);
  }
  return td.decode(stdout).trimEnd();
}

export async function inGitRepo(): Promise<boolean> {
  try {
    const out = await git(["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}
