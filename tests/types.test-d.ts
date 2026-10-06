// Type-level tests for the hand-written .d.ts files. Not run by vitest — this
// file is type-checked by `npm run typecheck` (tsc). `@ts-expect-error` lines
// fail the build if the expected type error stops happening, so the .d.ts can't
// silently drift from the public API.
import { initHotwireNative } from '../src/index.js'
import type { BridgeMessage, InitHotwireNativeOptions } from '../src/index.js'
import { useBridgeComponent } from '../src/react.js'
import { useBridgeComponent as useBridgeComponentVue } from '../src/vue.js'
import { useBridgeComponent as useBridgeComponentSvelte } from '../src/svelte.js'
import type { Ref } from 'vue'
import type { Readable } from 'svelte/store'

// --- initHotwireNative ---
initHotwireNative()
initHotwireNative({})
initHotwireNative({ debug: true })
initHotwireNative({ proposeFormRedirects: true })

// @ts-expect-error debug must be a boolean
initHotwireNative({ debug: 'yes' })

// @ts-expect-error unknown option rejected
initHotwireNative({ nope: true })

const opts: InitHotwireNativeOptions = { debug: false }
void opts

// --- global augmentation (README feature-detection pattern) ---
const isHotwireNative: boolean = !!window.webkit?.messageHandlers?.turbo
void isHotwireNative
const supportsForm: boolean | undefined = window.HotwireNative?.web.supportsComponent('form')
void supportsForm

// --- useBridgeComponent ---
const menu = useBridgeComponent('menu')
const supported: boolean = menu.supported
void supported
const restored: number = menu.restored
void restored
const id: string | null = menu.send('connect', { title: 'x' }, (m: BridgeMessage) => m.id)
void id
menu.send('event') // data/callback optional

// @ts-expect-error event name is required
menu.send()

// --- useBridgeComponent (Vue) ---
const vueMenu = useBridgeComponentVue('menu')
const vueSupported: Ref<boolean> = vueMenu.supported
void vueSupported
const vueId: string | null = vueMenu.send('connect', { title: 'x' }, (m: BridgeMessage) => m.id)
void vueId
vueMenu.send('event') // data/callback optional

// @ts-expect-error event name is required
vueMenu.send()

// --- useBridgeComponent (Svelte) ---
const svelteMenu = useBridgeComponentSvelte('menu')
const svelteSupported: Readable<boolean> = svelteMenu.supported
void svelteSupported
const svelteId: string | null = svelteMenu.send('connect', { title: 'x' }, (m: BridgeMessage) => m.id)
void svelteId
svelteMenu.send('event') // data/callback optional

// @ts-expect-error event name is required
svelteMenu.send()
