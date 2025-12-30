# gu — Git Utilities with a Better Terminal UX

`gu` (short for **Git Utilities**) is a tiny terminal app that wraps a few of the git tasks you do all the time—**but with a friendlier, safer, interactive UI**.

Git is powerful, but some daily workflows are noisy:
- “Which branches can I delete?”
- “Wait… does this branch have an open PR?”
- “I just want to do the right thing quickly without memorizing flags.”

`gu` exists to make those moments feel **fast, clean, and low‑stress**—without hiding what’s happening.

---

## Why `gu` exists

Git is an expert tool. Most of us don’t need *more* power—we need:
- **less friction** for everyday tasks
- **guardrails** (avoid deleting the wrong thing)
- **UX that matches what we’re trying to do**

`gu` is intentionally small and focused. It’s designed to be:
- **Interactive** (checkboxes, confirmations)
- **Safe by default**
- **Easy to install** (no Deno required for end users)
- **Configurable** (store tokens locally; no `.env` required)

---

## What it does today

### ✅ `clean-branches`
Interactively delete local branches:
- lists local branches
- excludes protected branches (defaults: `main, master, integration, develop`)
- optionally checks GitHub for **open PRs** and disables selection for branches that still have an open PR (safe default)
- delete with `-d`, then optionally offer force delete with `-D`

### ✅ `commit`
A lightweight commit helper:
- stages changes (safe defaults)
- helps structure commit text
- supports common flags (as you implement/extend)

### ✅ `configure`
Stores secrets locally so you don’t need dotenv:
- GitHub token (for PR checks)
- OpenAI API key (for future commands)

---

## Installation (macOS)

`gu` is distributed as a zip containing:
- `gu-macos-universal`
- `gu-macos-arm64`
- `gu-macos-x64`
- `install.sh`
- `uninstall.sh`

### Install

1) Download + unzip the release zip  
2) Run the installer:

```bash
bash install.sh
```

The installer will:
- ask which binary to install (or auto-detect)
- install to `~/.local/bin/gu`
- add `~/.local/bin` to your shell rc files if needed

> If `gu` isn’t available immediately, the installer prints the exact commands to reload your shell.

### Uninstall

```bash
bash uninstall.sh
```

You can optionally remove:
- the `gu` binary
- the PATH block added by the installer
- your local config (tokens)

---

## Quick Start

```bash
gu --help
gu configure
gu clean-branches
gu commit
```

---

## Configuration

`gu` stores configuration at:

- macOS: `~/Library/Application Support/gu/config.json`
- Linux: `~/.config/gu/config.json` (or `$XDG_CONFIG_HOME/gu/config.json`)

### Configure tokens

```bash
gu configure
```

Tips:
- In the configure prompt, **press Enter on an empty value** to clear a stored token/key.
- Tokens are stored locally in the config file (not in your shell environment).

### GitHub token permissions (for PR lookup)

For reading PRs in a repo:
- Public repos: a token typically works with default access
- Private repos: token needs access to that repo (commonly `repo` scope for classic tokens, or appropriate repo permissions for fine-grained tokens)

If PR lookup is disabled / skipped, `clean-branches` still works—just without PR awareness.

---

## Commands

### `gu clean-branches`

```bash
gu clean-branches
```

Useful options (depending on your implementation):
- `--allow-pr` — allow selecting branches that have an open PR
- `--no-prs` — skip PR lookup (offline mode)
- `--repo owner/repo` — override repo for PR lookup
- `--protected a,b,c` — override protected branches

### `gu commit`

```bash
gu commit
```

(Exact flags depend on your command implementation—extend it however your team likes.)

### `gu configure`

```bash
gu configure
```

---

## Development

### Requirements
- Deno (for contributors/builders)
- macOS tools for universal builds: `lipo`, `zip`

### Run locally

```bash
deno task gu --help
deno task gu clean-branches
```

### Build a release zip (macOS)

```bash
deno task release:mac
```

This generates a zip in `dist/` containing binaries + installer scripts.

> Note: Deno compiled binaries can be large because they embed the Deno runtime. A universal binary contains both architectures.

---

## Troubleshooting

### “command not found: gu”
Run the reload command the installer prints, for example:

```bash
source ~/.zshrc && rehash
```

Or minimal:

```bash
export PATH="$HOME/.local/bin:$PATH" && rehash
```

### “Failed to resolve 'git' for allow-run”
This happens when compiled permissions are overly strict (e.g., `--allow-run=git`) and the binary can’t resolve `git` at launch.  
Fix: compile with `--allow-run` instead (recommended), or ensure `git` is resolvable via PATH.

---

## Security notes

- `gu` can store tokens locally in a config file.
- Treat that file like any other secret store:
  - don’t commit it
  - keep your machine secure
  - rotate tokens if needed

---

## Roadmap ideas

A few directions `gu` could grow:
- smarter commit message templates
- branch cleanup that also checks remote branches
- PR utilities (open, list, checkout)
- optional AI-assisted summaries (opt-in)

(Keeping the tool small and ergonomic is the goal.)

---

## License

Choose whatever fits your repo (MIT/Apache-2.0/etc.).  
Add a `LICENSE` file when you’re ready.