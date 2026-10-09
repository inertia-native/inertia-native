import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findEntrypoints, patchEntrypoint } from '../bin/entrypoint.mjs'

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
import { initInertiaNative } from 'inertia-native';
import { Toaster } from '@/components/ui/sonner';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

initInertiaNative();

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
import { initInertiaNative } from "inertia-native"

import { initializeTheme } from "@/hooks/use-appearance"

initInertiaNative()

void createInertiaApp({
  strictMode: true,
}).catch((error) => {
  throw error
})
`
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('follows a no-semicolon style', () => {
    const source = `import './bootstrap'
import { createApp, h } from 'vue'
import { createInertiaApp } from '@inertiajs/vue3'
import '../css/app.css'

createInertiaApp({
  resolve: (name) => name,
})
`
    const expected = `import './bootstrap'
import { createApp, h } from 'vue'
import { createInertiaApp } from '@inertiajs/vue3'
import { initInertiaNative } from 'inertia-native'
import '../css/app.css'

initInertiaNative()

createInertiaApp({
  resolve: (name) => name,
})
`
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('handles multi-line imports and export default', () => {
    const source = `import {
  createInertiaApp,
  router,
} from '@inertiajs/react'
import './app.css'

export default createInertiaApp({})
`
    const expected = `import {
  createInertiaApp,
  router,
} from '@inertiajs/react'
import { initInertiaNative } from 'inertia-native'
import './app.css'

initInertiaNative()

export default createInertiaApp({})
`
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('keeps indentation inside a function', () => {
    const source = "import { createInertiaApp } from '@inertiajs/react'\n\nexport function boot() {\n  return createInertiaApp({})\n}\n"
    const expected =
      "import { createInertiaApp } from '@inertiajs/react'\nimport { initInertiaNative } from 'inertia-native'\n\nexport function boot() {\n  initInertiaNative()\n\n  return createInertiaApp({})\n}\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
  })

  it('handles const app = await createInertiaApp(', () => {
    const source = "import { createInertiaApp } from '@inertiajs/svelte'\n\nconst app = await createInertiaApp({})\n"
    expect(patchEntrypoint(source)).toEqual({
      status: 'patched',
      contents:
        "import { createInertiaApp } from '@inertiajs/svelte'\nimport { initInertiaNative } from 'inertia-native'\n\ninitInertiaNative()\n\nconst app = await createInertiaApp({})\n",
    })
  })

  it('keeps CRLF line endings', () => {
    const source = "import { createInertiaApp } from '@inertiajs/react';\r\n\r\ncreateInertiaApp({});\r\n"
    const expected =
      "import { createInertiaApp } from '@inertiajs/react';\r\nimport { initInertiaNative } from 'inertia-native';\r\n\r\ninitInertiaNative();\r\n\r\ncreateInertiaApp({});\r\n"
    expect(patchEntrypoint(source)).toEqual({ status: 'patched', contents: expected })
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
    ['two createInertiaApp calls', "import { createInertiaApp } from '@inertiajs/react'\n\ncreateInertiaApp({})\ncreateInertiaApp({})\n"],
    ['call continues the previous line', "import { createInertiaApp } from '@inertiajs/react'\n\nconst app =\n  createInertiaApp({})\n"],
    ['call nested in an expression', "import { createInertiaApp } from '@inertiajs/react'\n\nboot(createInertiaApp({}))\n"],
    ['no imports', 'createInertiaApp({})\n'],
    ['import without call', "import { createInertiaApp } from '@inertiajs/react'\nimport { initInertiaNative } from 'inertia-native'\n\ncreateInertiaApp({})\n"],
    ['call without import', "import { createInertiaApp } from '@inertiajs/react'\n\ninitInertiaNative()\ncreateInertiaApp({})\n"],
  ])('refuses when it cannot patch safely: %s', (_, source) => {
    const result = patchEntrypoint(source)
    expect(result.status).toBe('unpatchable')
    expect(/** @type {any} */ (result).reason).toBeTruthy()
    expect(result).not.toHaveProperty('contents')
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
