#!/usr/bin/env node
// Reference implementation of templates/CONTRACT.md.
// Usage: node scripts/fill-template.mjs <ios|android> <dest> --name Acme --bundle-id com.acme.app --url http://localhost:8000 [--force]
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'bundle-id': { type: 'string' },
    url: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
})

const [platform, dest] = positionals
if (!['ios', 'android'].includes(platform) || !dest) {
  console.error('usage: fill-template.mjs <ios|android> <dest> --name NAME --bundle-id ID --url URL [--force]')
  process.exit(1)
}

const checks = {
  name: [/^[A-Za-z0-9][A-Za-z0-9 .-]{0,29}$/, values.name],
  'bundle-id': [/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/, values['bundle-id']],
  url: [/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~-]+)*$/, values.url],
}
for (const [key, [pattern, value]] of Object.entries(checks)) {
  if (!value || !pattern.test(value)) {
    console.error(`invalid --${key}: ${value ?? '(missing)'}`)
    process.exit(1)
  }
}

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates', platform)
const target = resolve(dest)

if (existsSync(target)) {
  if (!values.force) {
    console.error(`${target} already exists (use --force)`)
    process.exit(1)
  }
  rmSync(target, { recursive: true })
}

const manifest = JSON.parse(readFileSync(join(source, 'inertia-native-template.json'), 'utf8'))
cpSync(source, target, { recursive: true })
rmSync(join(target, 'inertia-native-template.json'))

// npm drops `.gitignore` from packages, so templates ship them as `gitignore`.
for (const file of readdirSync(target, { recursive: true })) {
  if (basename(file) === 'gitignore') {
    renameSync(join(target, file), join(target, dirname(file), '.gitignore'))
  }
}

const replacements = {
  __APP_NAME__: values.name,
  __BUNDLE_ID__: values['bundle-id'],
  __BASE_URL__: values.url,
}
for (const file of manifest.files) {
  const path = join(target, file)
  let content = readFileSync(path, 'utf8')
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replaceAll(placeholder, value)
  }
  writeFileSync(path, content)
}

console.log(`${platform} shell written to ${target}`)
