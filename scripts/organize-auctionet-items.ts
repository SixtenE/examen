import { constants } from "node:fs";
import { access, mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";

type Summary = {
  moved: number;
  skipped: number;
  conflicts: number;
};

const DEFAULT_ITEMS_DIR = "data/auctionet/items";

function usage() {
  return [
    "Usage: pnpm organize:auctionet-items -- [--dry-run] [--items <dir>]",
    "",
    "Options:",
    `  --items <dir>       Items directory to organize (default: ${DEFAULT_ITEMS_DIR})`,
    "  --dry-run           Preview the moves without changing files",
  ].join("\n");
}

function readOptionValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function parseArgs(args: string[]) {
  let itemsDir = DEFAULT_ITEMS_DIR;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--items":
        itemsDir = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    itemsDir,
    dryRun,
  };
}

function getPrefix(filename: string) {
  return filename.slice(0, 3);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function organizeItems(itemsDir: string, dryRun: boolean) {
  const summary: Summary = {
    moved: 0,
    skipped: 0,
    conflicts: 0,
  };

  const entries = await readdir(itemsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/^\d+\.json$/.test(entry.name)) {
      summary.skipped += 1;
      continue;
    }

    const filename = entry.name;
    const prefix = getPrefix(filename);
    const sourcePath = path.join(itemsDir, filename);
    const destinationDir = path.join(itemsDir, prefix);
    const destinationPath = path.join(destinationDir, filename);

    if (await fileExists(destinationPath)) {
      summary.conflicts += 1;
      summary.skipped += 1;
      console.log(`conflict: ${path.relative(itemsDir, destinationPath)}`);
      continue;
    }

    if (dryRun) {
      summary.moved += 1;
      console.log(`move: ${path.relative(itemsDir, sourcePath)} -> ${path.relative(itemsDir, destinationPath)}`);
      continue;
    }

    await mkdir(destinationDir, { recursive: true });
    await rename(sourcePath, destinationPath);
    summary.moved += 1;
    console.log(`moved: ${path.relative(itemsDir, sourcePath)} -> ${path.relative(itemsDir, destinationPath)}`);
  }

  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const itemsDir = path.resolve(options.itemsDir);

  const summary = await organizeItems(itemsDir, options.dryRun);

  console.log(
    `Summary: moved ${summary.moved}, skipped ${summary.skipped}, conflicts ${summary.conflicts}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exitCode = 1;
});
