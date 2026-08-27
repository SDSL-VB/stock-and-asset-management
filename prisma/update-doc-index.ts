/**
 * Rebuilds the contents list at the top of README.md and summary.md.
 *
 * Hand-written indexes rot the moment a section is renamed — README's had
 * drifted to list pages that no longer exist and miss half the ones that do.
 * This reads the real headings and regenerates the list between the markers,
 * so it is always what the document actually contains.
 *
 * Run with: npm run docs:index
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

const START = "<!-- index:start -->";
const END = "<!-- index:end -->";

/**
 * GitHub's heading slug rules: lowercase, drop anything that is not a letter,
 * digit, underscore, space or hyphen, then spaces become hyphens. Repeated
 * spaces become repeated hyphens, which is why "Roles & what each can do"
 * becomes "roles--what-each-can-do".
 */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Strips markdown emphasis and code ticks from a heading's display text. */
function clean(heading: string): string {
  return heading.replace(/`/g, "").replace(/\*\*/g, "").trim();
}

function buildIndex(source: string, opts: { includeSubheadings?: boolean }): string {
  const lines = source.split("\n");
  const entries: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;

    const h2 = /^## (?!Contents\b)(.+)$/.exec(line);
    if (h2) {
      const text = clean(h2[1]);
      entries.push(`- [${text}](#${slugify(h2[1])})`);
      continue;
    }

    if (opts.includeSubheadings) {
      const h3 = /^### (.+)$/.exec(line);
      if (h3) {
        const text = clean(h3[1]);
        entries.push(`  - [${text}](#${slugify(h3[1])})`);
      }
    }
  }

  return `${START}\n\n## Contents\n\n${entries.join("\n")}\n\n${END}`;
}

/**
 * Puts the index directly after the document's title, replacing any previous
 * one. Everything between the markers is owned by this script.
 */
function applyIndex(file: string, opts: { includeSubheadings?: boolean } = {}) {
  const path = join(ROOT, file);
  let source = readFileSync(path, "utf8");

  // Strip whatever is currently between the markers
  const existing = new RegExp(`${START}[\\s\\S]*?${END}\\n*`, "g");
  source = source.replace(existing, "");

  const index = buildIndex(source, opts);

  // After the H1 and any blockquote/intro that immediately follows it
  const lines = source.split("\n");
  let insertAt = lines.findIndex((l) => l.startsWith("# ")) + 1;
  if (insertAt === 0) throw new Error(`${file} has no H1`);

  while (
    insertAt < lines.length &&
    (lines[insertAt].trim() === "" ||
      lines[insertAt].startsWith(">") ||
      (!lines[insertAt].startsWith("#") && lines[insertAt].trim() !== "---"))
  ) {
    insertAt += 1;
  }

  lines.splice(insertAt, 0, "", index, "");
  writeFileSync(path, lines.join("\n"));

  const count = (index.match(/^- \[/gm) ?? []).length;
  const subs = (index.match(/^ {2}- \[/gm) ?? []).length;
  console.log(
    `  ${file}: ${count} section${count === 1 ? "" : "s"}${subs ? `, ${subs} subsections` : ""}`
  );
}

console.log("Rebuilding document indexes...\n");
applyIndex("README.md", { includeSubheadings: true });
applyIndex("summary.md");
console.log(
  "\nRun again after renaming or adding a section. permissions.md builds its own — regenerate it with generate-permissions-doc.ts."
);
