#!/usr/bin/env bash
# Runs the analysis of .github/workflows/codeql.yml with a locally installed
# CodeQL CLI: same config file, same security-extended suite. Installs nothing.
#
# Usage: scripts/codeql-local.sh [javascript-typescript|actions|java-kotlin ...]
# Default is all three. java-kotlin needs JDK 17+, Gradle 8.14.3 (or set GRADLE)
# and an Android SDK with platform 34 / build-tools 35.0.0 in ANDROID_HOME.
# Results: build/codeql/<language>.sarif (ignored by Git).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="$root/.github/codeql/codeql-config.yml"
out="${CODEQL_OUT:-$root/build/codeql}"
codeql="${CODEQL:-codeql}"
gradle="${GRADLE:-gradle}"

if ! command -v "$codeql" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
CodeQL CLI not found (set CODEQL to its path if it is not on PATH).
Install the CodeQL bundle, which includes the query suites, from the official release page:
  https://github.com/github/codeql-action/releases
Setup guide: https://docs.github.com/en/code-security/codeql-cli/getting-started-with-the-codeql-cli/setting-up-the-codeql-cli
EOF
  exit 127
fi

if [ "$#" -gt 0 ]; then languages=("$@"); else languages=(javascript-typescript actions java-kotlin); fi

for language in "${languages[@]}"; do
  case "$language" in
    javascript-typescript | actions) build=(--build-mode=none) ;;
    java-kotlin)
      if ! command -v "$gradle" >/dev/null 2>&1 || [ -z "${ANDROID_HOME:-}" ]; then
        echo "java-kotlin needs Gradle (or GRADLE=<path>) and ANDROID_HOME; run with other languages to skip it." >&2
        exit 2
      fi
      # Kotlin must compile in-process and non-incrementally for the extractor to see every file.
      build=(--build-mode=manual "--command=$gradle --no-daemon --no-build-cache --rerun-tasks --console=plain -p apps/quest-app/spatial -Pkotlin.compiler.execution.strategy=in-process -Pkotlin.incremental=false :core:compileTestKotlin :app:compileDebugJavaWithJavac")
      ;;
    *)
      echo "unsupported language: $language" >&2
      exit 2
      ;;
  esac
  db="$out/db/$language"
  sarif="$out/$language.sarif"
  mkdir -p "$out/db"
  echo "== $language: creating database"
  (cd "$root" && "$codeql" database create "$db" --overwrite --language="$language" --source-root="$root" \
    --codescanning-config="$config" "${build[@]}")
  echo "== $language: analysing"
  # No query argument: the suite comes from the config recorded in the database.
  "$codeql" database analyze "$db" --format=sarif-latest --output="$sarif" \
    --sarif-category="/language:$language"
  node "$root/scripts/codeql-sarif-summary.ts" "$sarif"
done
