import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// The second list excludes deleted specs; the first includes every touched test.
export function checkSpecTests(
  changedFiles: readonly string[],
  addedOrModifiedFiles: readonly string[] = changedFiles,
): boolean {
  const hasSpec = addedOrModifiedFiles.some(
    (file) => /^docs\/specs\/[^/]+\.md$/.test(file) && !/^docs\/specs\/(TEMPLATE|README)\.md$/.test(file),
  );
  const hasTest = changedFiles.some((file) => /^test\/(?:[^/]+\.test\.ts|e2e\/[^/]+\.spec\.ts)$/.test(file));
  return !hasSpec || hasTest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, ...rest] = process.argv.slice(2);
  if (!base || base.startsWith("-") || rest.length) {
    console.error("Usage: node scripts/check-spec-tests.ts BASE_REF");
    process.exitCode = 1;
  } else {
    try {
      const diff = (filter: string) =>
        execFileSync(
          "git",
          ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", filter, `${base}...HEAD`, "--"],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        )
          .split("\0")
          .filter(Boolean);
      if (!checkSpecTests(diff("--diff-filter=ACDMRTUXB"), diff("--diff-filter=AM"))) {
        console.error(
          "spec-requires-tests: added or modified docs/specs/*.md requires a test/*.test.ts or test/e2e/*.spec.ts change in the same diff (TEMPLATE.md and README.md are exempt).",
        );
        process.exitCode = 1;
      } else console.log("spec-requires-tests: passed");
    } catch {
      console.error(
        "spec-requires-tests: unable to diff BASE_REF...HEAD; ensure the base ref and full history are available.",
      );
      process.exitCode = 1;
    }
  }
}
