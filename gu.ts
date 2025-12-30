import { Command } from "@cliffy/command";
import { cleanBranchesCmd } from "./commands/clean_branches.ts";
import { commitCmd } from "./commands/commit.ts";
import { configureCmd } from "./commands/configure.ts";

const app = new Command()
  .name("gu")
  .version("0.1.0")
  .description("Git utilities")
  .command("configure", configureCmd)
  .command("clean-branches", cleanBranchesCmd)
  .command("commit", commitCmd);

await app.parse(Deno.args.length ? Deno.args : ["--help"]);
