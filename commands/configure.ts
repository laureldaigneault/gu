// commands/configure.ts
import { Command } from "@cliffy/command";
import { Confirm, Secret, Select } from "@cliffy/prompt";

import {
  configPath,
  getGithubToken,
  getOpenAIApiKey,
  setGithubToken,
  clearGithubToken,
  setOpenAIApiKey,
  clearOpenAIApiKey,
} from "../config.ts";

type ConfigChoice = "github" | "openai" | "show";

function mask(s: string): string {
  if (s.length <= 8) return "********";
  return `${s.slice(0, 3)}…${s.slice(-3)}`;
}

async function upsertSecret(
  label: string,
  current: string | null,
  save: (v: string) => Promise<void>,
  clear: () => Promise<void>,
) {
  console.log(`Config: ${configPath()}`);
  console.log(`${label}: ${current ? `set (${mask(current)})` : "not set"}`);
  console.log("Tip: press Enter on an empty value to clear it.\n");

  const value = await Secret.prompt({
    message: `Enter ${label}`,
    minLength: 0,
  });

  const trimmed = value.trim();

  if (trimmed === "") {
    if (!current) {
      console.log(`${label} already not set.`);
      return;
    }
    const ok = await Confirm.prompt(`Clear ${label}?`);
    if (!ok) return console.log("Cancelled.");
    await clear();
    console.log(`${label} cleared.`);
    return;
  }

  const ok = await Confirm.prompt(`Save ${label}?`);
  if (!ok) return console.log("Cancelled.");
  await save(trimmed);
  console.log(`${label} saved ✅`);
}

export const configureCmd = new Command()
  .description("Configure gu (store tokens locally in a config file).")
  .option("--path", "Print the config file path and exit.")
  .action(async (opts) => {
    if (opts.path) {
      console.log(configPath());
      return;
    }

    const gh = await getGithubToken();
    const oa = await getOpenAIApiKey();

    const choice = await Select.prompt<ConfigChoice>({
      message: "What do you want to configure?",
      options: [
        { name: `GitHub token ${gh ? `(set: ${mask(gh)})` : "(not set)"}`, value: "github" },
        { name: `OpenAI API key ${oa ? `(set: ${mask(oa)})` : "(not set)"}`, value: "openai" },
        { name: "Show status", value: "show" },
      ],
    });

    if (choice === "show") {
      console.log(`Config: ${configPath()}`);
      console.log(`GitHub token: ${gh ? "set ✅" : "not set ❌"}`);
      console.log(`OpenAI API key: ${oa ? "set ✅" : "not set ❌"}`);
      return;
    }

    if (choice === "github") {
      await upsertSecret("GitHub token", gh, setGithubToken, clearGithubToken);
      return;
    }

    if (choice === "openai") {
      await upsertSecret("OpenAI API key", oa, setOpenAIApiKey, clearOpenAIApiKey);
      return;
    }
  });
