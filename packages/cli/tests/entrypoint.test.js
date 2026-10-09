import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findEntrypoints, initializer, patchEntrypoint } from '../bin/entrypoint.mjs'

describe('patchEntrypoint', () => {
  it('patches the Laravel React starter kit entrypoint', () => {
    const source = `import { createInertiaApp } from '@inertiajs/react';
import { Toaster } from '@/components/ui/sonner';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

void createInertiaApp({
    title: (title) => (title ? \`\${title} - \${appName}\` : appName),
});

// This will set light / dark mode on load...
initializeTheme();
`
    const expected = `import { createInertiaApp } from '@inertiajs/react';
import './inertia-native';
import { Toaster } from '@/components/ui/sonner';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

void createInertiaApp({
    title: (title) => (title ? \`\${title} - \${appName}\` : appName),
});

// This will set light / dark mode on load...
initializeTheme();
`
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('patches the Rails React starter kit entrypoint (double quotes, no semicolons)', () => {
    const source = `import { createInertiaApp } from "@inertiajs/react"

import { initializeTheme } from "@/hooks/use-appearance"

void createInertiaApp({
  strictMode: true,
}).catch((error) => {
  throw error
})
`
    const expected = `import { createInertiaApp } from "@inertiajs/react"
import "./inertia-native"

import { initializeTheme } from "@/hooks/use-appearance"

void createInertiaApp({
  strictMode: true,
}).catch((error) => {
  throw error
})
`
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('adds the import after the createInertiaApp import', () => {
    const source = "import './bootstrap'\nimport { createInertiaApp } from '@inertiajs/vue3'\nimport '../css/app.css'\n\ncreateInertiaApp({})\n"
    const expected =
      "import './bootstrap'\nimport { createInertiaApp } from '@inertiajs/vue3'\nimport './inertia-native'\nimport '../css/app.css'\n\ncreateInertiaApp({})\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('handles multi-line imports', () => {
    const source = "import {\n  createInertiaApp,\n  router,\n} from '@inertiajs/react'\nimport './app.css'\n\nexport default createInertiaApp({})\n"
    const expected =
      "import {\n  createInertiaApp,\n  router,\n} from '@inertiajs/react'\nimport './inertia-native'\nimport './app.css'\n\nexport default createInertiaApp({})\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('falls back to after the last import', () => {
    const source = "import * as Inertia from '@inertiajs/react'\nimport './app.css'\n\nInertia.createInertiaApp({})\n"
    const expected = "import * as Inertia from '@inertiajs/react'\nimport './app.css'\nimport './inertia-native'\n\nInertia.createInertiaApp({})\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('inserts the import after a trailing comment, not further down', () => {
    const source = "import { createInertiaApp } from '@inertiajs/react' // the app\nconst meta = {\n  title: 'Shop'\n}\n\ncreateInertiaApp({ meta })\n"
    const expected =
      "import { createInertiaApp } from '@inertiajs/react' // the app\nimport './inertia-native'\nconst meta = {\n  title: 'Shop'\n}\n\ncreateInertiaApp({ meta })\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('keeps CRLF line endings', () => {
    const source = "import { createInertiaApp } from '@inertiajs/react';\r\n\r\ncreateInertiaApp({});\r\n"
    const expected = "import { createInertiaApp } from '@inertiajs/react';\r\nimport './inertia-native';\r\n\r\ncreateInertiaApp({});\r\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  const head = "import { createInertiaApp } from '@inertiajs/react'\n"

  it.each([
    ['inside a function', 'export function boot() {\n  return createInertiaApp({})\n}\n'],
    ['in an arrow body', 'const boot = () =>\n  createInertiaApp({})\nboot()\n'],
    ['in an arrow body in a callback', "document.addEventListener('DOMContentLoaded', () =>\n  createInertiaApp({}))\n"],
    ['in an if without braces', "if (document.getElementById('app'))\n  createInertiaApp({})\n"],
    ['in an else without braces', 'if (window.x) foo()\nelse\n  createInertiaApp({})\n'],
    ['in a loop without braces', 'for (const el of roots)\n  createInertiaApp({})\n'],
    ['on a continued line', 'const app =\n  createInertiaApp({})\n'],
    ['nested in an expression', 'boot(createInertiaApp({}))\n'],
    ['twice', 'createInertiaApp({})\ncreateInertiaApp({})\n'],
  ])('patches wherever createInertiaApp( is called: %s', (_, body) => {
    expect(patchEntrypoint(`${head}\n${body}`)).toEqual({ status: 'patched', contents: `${head}import './inertia-native'\n\n${body}` })
  })

  it('is idempotent', () => {
    const once = patchEntrypoint("import { createInertiaApp } from '@inertiajs/react'\n\ncreateInertiaApp({})\n")
    expect(once.status).toBe('patched')
    expect(patchEntrypoint(/** @type {any} */ (once).contents)).toEqual({ status: 'already_patched' })
  })

  it('recognises a hand-written setup', () => {
    const source =
      "import { createInertiaApp } from '@inertiajs/react'\nimport { initInertiaNative } from \"inertia-native\"\n\ninitInertiaNative({ debug: true })\ncreateInertiaApp({})\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'already_patched' })
  })

  it.each([
    ['no createInertiaApp call', "import { createApp } from 'vue'\n\ncreateApp({}).mount('#app')\n"],
    ['no imports', "const { createInertiaApp } = require('@inertiajs/react')\n\ncreateInertiaApp({})\n"],
    ['import without call', "import { createInertiaApp } from '@inertiajs/react'\nimport { initInertiaNative } from 'inertia-native'\n\ncreateInertiaApp({})\n"],
    ['call without import', "import { createInertiaApp } from '@inertiajs/react'\n\ninitInertiaNative()\ncreateInertiaApp({})\n"],
  ])('refuses when it cannot patch safely: %s', (_, source) => {
    const result = patchEntrypoint(source)
    expect(result.status).toBe('unpatchable')
    expect(/** @type {any} */ (result).reason).toBeTruthy()
    expect(result).not.toHaveProperty('contents')
  })
})

describe('initializer', () => {
  it('writes a TypeScript file next to a TypeScript entrypoint, in its style', () => {
    expect(initializer('/app/resources/js/app.tsx', "import { createInertiaApp } from '@inertiajs/react';\n")).toEqual({
      path: '/app/resources/js/inertia-native.ts',
      contents:
        "import { initInertiaNative } from 'inertia-native';\n\n" +
        "// Lets the iOS and Android apps drive Inertia's navigation; does nothing in\n" +
        '// a regular browser. Options: https://inertia-native.dev\n' +
        'initInertiaNative();\n',
    })
  })

  it('writes a JavaScript file next to a JavaScript entrypoint, with CRLF', () => {
    const { path, contents } = initializer('/app/app/frontend/entrypoints/inertia.js', 'import { createInertiaApp } from "@inertiajs/vue3"\r\n')
    expect(path).toBe('/app/app/frontend/entrypoints/inertia-native.js')
    expect(contents).toMatch(/^import \{ initInertiaNative \} from "inertia-native"\r\n/)
    expect(contents).toMatch(/\r\ninitInertiaNative\(\)\r\n$/)
  })
})

describe('findEntrypoints', () => {
  let root
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'inertia-native-entry-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const file = (path, content = "import { createInertiaApp } from '@inertiajs/react'\ncreateInertiaApp({})\n") => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  it('finds files that call createInertiaApp( in the usual directories, in search order', () => {
    file('src/main.ts')
    file('app/javascript/entrypoints/inertia.tsx')
    file('resources/js/app.tsx')
    file('app/frontend/entrypoints/application.js')
    expect(findEntrypoints(root)).toEqual([
      'resources/js/app.tsx',
      'app/frontend/entrypoints/application.js',
      'app/javascript/entrypoints/inertia.tsx',
      'src/main.ts',
    ])
  })

  it('prefers shallower files within a directory', () => {
    file('resources/js/nested/deep/boot.js')
    file('resources/js/app.js')
    expect(findEntrypoints(root)).toEqual(['resources/js/app.js', 'resources/js/nested/deep/boot.js'])
  })

  it('skips SSR entrypoints, node_modules, tests, type files and files without the call', () => {
    file('resources/js/app.tsx')
    file('resources/js/ssr.tsx')
    file('app/frontend/ssr/ssr.ts')
    file('src/server.tsx', "import { createInertiaApp } from '@inertiajs/react'\nimport { renderToString } from 'react-dom/server'\ncreateInertiaApp({})\n")
    file('src/vue-ssr.js', "import { createInertiaApp } from '@inertiajs/vue3'\nimport { renderToString } from 'vue/server-renderer'\ncreateInertiaApp({})\n")
    file('src/node_modules/x/index.js')
    file('src/app.test.ts')
    file('src/types.d.ts')
    file('src/other.ts', "import { router } from '@inertiajs/react'\n")
    file('src/notes.md')
    expect(findEntrypoints(root)).toEqual(['resources/js/app.tsx'])
  })

  it('finds entrypoints of an app that lives in a directory named ssr', () => {
    file('ssr/resources/js/app.tsx')
    expect(findEntrypoints(join(root, 'ssr'))).toEqual(['resources/js/app.tsx'])
  })

  it('finds nothing in an empty project', () => {
    expect(findEntrypoints(root)).toEqual([])
  })
})
