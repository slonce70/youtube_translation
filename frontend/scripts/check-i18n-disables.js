#!/usr/bin/env node
// Guard against drift on the i18n cleanup story.
//
// Sprint 3 lifted 9 of 13 file-level `eslint-disable i18next/no-literal-string`
// directives. Four large dashboard pages retain their disables under
// TODO(sprint-3.5) — those are documented and audited. This script enforces
// that the count of disables does NOT grow above the documented baseline.
//
// To intentionally raise the baseline, edit DISABLE_BASELINE_PATH below.
// Lowering is always safe (run `npm run i18n:disable-check`); the script
// passes whenever current_count <= baseline_count.

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
// NOT global — global RegExp.test() advances lastIndex between calls and
// causes spurious misses on the second pattern check (the loop below).
const PATTERN = /eslint-disable[^\n]*i18next\/no-literal-string/

// Baseline: list of files where the disable is intentional + audited.
// Anything beyond this set causes a non-zero exit.
const ALLOWED_FILES = new Set([
  'app/dashboard/library/page.tsx',
  'app/dashboard/page.tsx',
  'app/dashboard/streaming/components/StreamBuilderModal.tsx',
  'app/dashboard/streaming/page.tsx',
])

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      yield full
    }
  }
}

const offenders = []
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8')
  if (PATTERN.test(text)) {
    const rel = path.relative(SRC, file)
    if (!ALLOWED_FILES.has(rel)) {
      offenders.push(rel)
    }
  }
}

if (offenders.length > 0) {
  console.error(
    '\n❌ Unauthorized eslint-disable i18next/no-literal-string in:\n' +
      offenders.map((f) => `   - src/${f}`).join('\n') +
      '\n\nLift the disable (preferred) OR add the file to ALLOWED_FILES in\n' +
      'frontend/scripts/check-i18n-disables.js with an audit reference.\n'
  )
  process.exit(1)
}

const allowedRemaining = []
for (const allowed of ALLOWED_FILES) {
  const full = path.join(SRC, allowed)
  if (!fs.existsSync(full)) continue
  const text = fs.readFileSync(full, 'utf8')
  if (PATTERN.test(text)) {
    allowedRemaining.push(allowed)
  }
}

console.log(
  `✔ i18n-disable baseline holds (${allowedRemaining.length}/${ALLOWED_FILES.size} grandfathered files).`
)
