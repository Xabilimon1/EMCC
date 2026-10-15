// The awesome-claude-code-mods catalogue publishes a repository only when none of its mods
// carries a compatibility warning, and it warns on any string literal with a control character
// in the source a hooks module reaches (tools/compatibility.mjs, `ui-control-characters`).
// One `'\r'` used to split lines keeps all five mods out, so this check runs the same rule
// over every mod, whether or not it draws: a mod that starts drawing later is already clean.
//
//   npm install --no-save typescript@5.9 && node scripts/check-ui-strings.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

function sourceFile(path) {
  const candidates = [path]
  if (!extname(path)) candidates.push(...extensions.flatMap(ext => [path + ext, join(path, 'index' + ext)]))
  if (/\.[cm]?jsx?$/.test(path)) candidates.push(path.replace(/\.[cm]?jsx?$/, '.ts'), path.replace(/\.[cm]?jsx?$/, '.tsx'))
  return candidates.find(c => existsSync(c) && statSync(c).isFile() && extensions.includes(extname(c)) && !c.endsWith('.d.ts')) ?? null
}

const found = []
for (const mod of readdirSync(join(root, 'mods'))) {
  const manifest = join(root, 'mods', mod, 'hooks', 'hooks.json')
  if (!existsSync(manifest)) continue
  const seen = new Set()
  const visit = path => {
    const file = sourceFile(path)
    if (!file || seen.has(file)) return
    seen.add(file)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const imports = []
    const walk = node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        if (controls.test(node.text)) found.push(`${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
      }
      if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) || (ts.isExportDeclaration(node) && !node.isTypeOnly)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
    for (const specifier of imports) if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier))
  }
  for (const module of JSON.parse(readFileSync(manifest, 'utf8')).modules ?? []) {
    if (typeof module === 'string') visit(resolve(dirname(manifest), module))
  }
}

if (found.length) {
  console.error('Control characters in string literals (the catalogue would hold the whole repository back):')
  for (const at of found) console.error(`  ${at}`)
  console.error('Match them with a regular expression instead, or take them from the text being handled.')
  process.exit(1)
}
console.log('No control characters in hook string literals.')
