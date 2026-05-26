/**
 * govctl mode - View or set product/runtime enforcement mode.
 */

import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import {
  govPath,
  loadState,
  readYamlFile,
  writeYamlFile,
  appendCleanStateEvent,
} from "@govruntime/govd";

type RuntimeMode = "advisory" | "hard-block";

export function registerMode(program: Command): void {
  const modeCmd = program.command("mode").description("View or set runtime enforcement mode");

  modeCmd
    .command("show")
    .description("Show runtime product and enforcement mode")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const cwd = path.resolve(opts.cwd);
      const state = loadState(cwd);
      console.log(chalk.bold.cyan("\nGovRuntime Mode\n"));
      console.log(`  Namespace:    ${state.runtime_config.namespace}`);
      console.log(`  Product mode: ${state.runtime_config.product_mode}`);
      console.log(`  Enforcement:  ${state.runtime_config.enforcement_mode}`);
      console.log(`  Clean log:    .governance/${state.runtime_config.clean_state_log}`);
      console.log("");
    });

  modeCmd
    .command("set <mode>")
    .description("Set enforcement mode: advisory or hard-block")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action((mode: RuntimeMode, opts: { cwd: string }) => {
      if (mode !== "advisory" && mode !== "hard-block") {
        console.log(chalk.red("\n  Mode must be advisory or hard-block.\n"));
        return;
      }

      const cwd = path.resolve(opts.cwd);
      const constitutionPath = govPath(cwd, "constitution.yaml");
      const constitution = readYamlFile<Record<string, unknown>>(constitutionPath) ?? {};
      const runtime = (constitution["runtime"] as Record<string, unknown> | undefined) ?? {};
      runtime["namespace"] = "@govruntime";
      runtime["enforcement_mode"] = mode;
      constitution["runtime"] = runtime;

      writeYamlFile(constitutionPath, constitution);
      appendCleanStateEvent(cwd, {
        phase: "init",
        event: "runtime_mode_changed",
        mode,
        clean: true,
        created_at: new Date().toISOString(),
      });

      console.log(chalk.bold.cyan("\nGovRuntime Mode Updated\n"));
      console.log(`  Enforcement: ${chalk.green(mode)}`);
      console.log("");
    });
}
