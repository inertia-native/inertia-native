// Type-level tests for the hand-written .d.ts files. Not run by vitest — this
// file is type-checked by `npm run typecheck` (tsc). `@ts-expect-error` lines
// fail the build if the expected type error stops happening, so the .d.ts can't
// silently drift from the public API.
import { initHotwireNative } from '../src/index.js'
import type { BridgeMessage, InitHotwireNativeOptions } from '../src/index.js'
import { useBridgeComponent } from '../src/react.js'

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
