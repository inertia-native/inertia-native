# Inertia Native

[![CI](https://github.com/inertia-native/inertia-native/actions/workflows/ci.yml/badge.svg)](https://github.com/inertia-native/inertia-native/actions/workflows/ci.yml)

Drive [Inertia.js](https://inertiajs.com) navigation and bridge components from
[Hotwire Native](https://native.hotwired.dev) (iOS & Android).

Hotwire Native injects a `turbo.js` script into every web view that expects a
`window.Turbo` object to drive. This package provides a small shim that maps the
native adapter protocol onto Inertia's router, so Inertia pages push, pop, and
restore as native screens — and a web bridge so Inertia pages can use native
bridge components (submit buttons, menus, etc.).

In a regular browser it stays inert: with no native adapter connected, Inertia
navigates exactly as usual.

- **Framework-agnostic core** (`.`) — peer-depends on `@inertiajs/core`.
- **React bindings** (`./react`) — optional, peer-depends on `react`.
- **Vue bindings** (`./vue`) — optional, peer-depends on `vue`.
- **Svelte bindings** (`./svelte`) — optional, peer-depends on `svelte`.

Docs: [inertia-native.dev](https://inertia-native.dev). Formerly published as
`inertia-hotwire-native`. A community project, not affiliated with the
Inertia.js team.

## Quick start

To set up an existing Inertia app and run it in a simulator:

```bash
npx inertia-native init
npm run ios      # or: npm run android
```

`init` installs the package, adds an `inertia-native.ts` setup file imported
by your entrypoint and creates the `ios/` and `android/` apps; start your dev
server before `npm run ios`. The
[quick start](https://inertia-native.dev/guide/quick-start) walks through it.
To set things up by hand, see [Install](#install) and [Usage](#usage).

## Install

```bash
npm add inertia-native
```

## Usage

Call `initInertiaNative()` once, before `createInertiaApp`, in your Inertia
entrypoint:

```js
import { createInertiaApp } from '@inertiajs/react'
import { initInertiaNative } from 'inertia-native'

const isNativeApp = !!window.webkit?.messageHandlers?.turbo
initInertiaNative({ debug: import.meta.env.DEV || isNativeApp })

createInertiaApp({ /* ... */ })
```

That's all that's needed for native navigation (push/pop/replace/restore,
modals, forms, error screens, pull-to-refresh).

### Form redirects

By default a form's result stays in the web view the form was in. Pass
`proposeFormRedirects: true` to propose the page a form lands on to native
instead, as Turbo does — native's path configuration then decides, e.g.
dismissing a modal to show the result in the main stack. Validation errors
redirect back to the form's own URL and are not proposed.

```js
initInertiaNative({ proposeFormRedirects: true })
```

### Bridge components (React)

`useBridgeComponent(name)` is the generic primitive: it returns whether the
connected native app supports the component and a stable `send(event, data?,
callback?)`. Build specific components (`form`, `menu`, `overflow-menu`, …) in
your app on top of it.

The shells that `npx inertia-native init` creates ship these native
components. Native replies to the message you sent, which calls its `callback`:

| Component       | Send                                                               | Native replies                         |
| --------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `button`        | `connect` `{ title, side? }` (`side: 'left'` is iOS only)          | on each tap                            |
| `form`          | `connect` `{ submitTitle }`; `submitEnabled`, `submitDisabled`     | on each tap of the submit button       |
| `menu`          | `display` `{ title, items: [{ title, index }], source? }`          | `{ selectedIndex }`; nothing on cancel |
| `overflow-menu` | `connect` `{ label }`                                              | on each tap                            |
| `alert`         | `show` `{ title, description?, destructive?, confirm?, dismiss? }` | on confirm; nothing on dismiss         |

`source` is the tapped element's `getBoundingClientRect()` (`{ x, y, width,
height }`); where the menu shows as a popover (iPad), it points there.

```jsx
import { useBridgeComponent } from 'inertia-native/react'

// items: ['Edit', 'Delete']; onSelect gets the picked index.
function NativeMenu({ title, items, onSelect }) {
  const { supported, send } = useBridgeComponent('menu')
  if (!supported) return null

  const open = () =>
    send(
      'display',
      { title, items: items.map((item, index) => ({ title: item, index })) },
      (message) => onSelect(message.data.selectedIndex)
    )

  return <button onClick={open}>Open menu</button>
}
```

Each `send` returns a message id; native replies invoke the `callback`. The
hook re-checks support when the native handshake completes after mount.

A component that draws native UI on `connect` should send it again when the
web view returns from a native screen (`native:restore`, dispatched on
Android). Put `restored` in the deps of the effect that sends it:

```jsx
const { supported, send, restored } = useBridgeComponent('button')

useEffect(() => {
  if (!supported) return
  const id = send('connect', { title }, onTap)
  return () => window.HotwireNative?.web?.removeCallback(id)
}, [supported, title, send, restored])
```

### Bridge components (Vue)

The Vue entry exposes the same `useBridgeComponent(name)` composable.
`supported` and `restored` are `Ref`s, so unwrap them with `.value` (or use
them in a template); `send` has the same signature.

```vue
<script setup>
import { useBridgeComponent } from 'inertia-native/vue'

const props = defineProps(['title', 'items'])
const emit = defineEmits(['select'])
const { supported, send } = useBridgeComponent('menu')

function open() {
  const items = props.items.map((item, index) => ({ title: item, index }))
  send('display', { title: props.title, items }, (message) =>
    emit('select', message.data.selectedIndex)
  )
}
</script>

<template>
  <button v-if="supported" @click="open">Open menu</button>
</template>
```

To send `connect` again after `native:restore`, watch `restored` alongside the
other sources of the watcher that sends it.

### Bridge components (Svelte)

The Svelte entry exposes `useBridgeComponent(name)` too. `supported` and
`restored` are readable stores (subscribe with `$supported`, `$restored`);
`send` has the same signature. Call it during component initialization — it
registers an `onDestroy` cleanup.

```svelte
<script>
  import { useBridgeComponent } from 'inertia-native/svelte'

  export let title
  export let items
  export let onSelect
  const { supported, send } = useBridgeComponent('menu')

  const open = () =>
    send(
      'display',
      { title, items: items.map((item, index) => ({ title: item, index })) },
      (message) => onSelect(message.data.selectedIndex)
    )
</script>

{#if $supported}
  <button on:click={open}>Open menu</button>
{/if}
```

To send `connect` again after `native:restore`, reference `$restored` in the
reactive statement that sends it.

## Requirements

- `@inertiajs/core` >= 3.0
- `react` >= 18 (only for the `./react` entry)
- `vue` >= 3.0 (only for the `./vue` entry)
- `svelte` >= 4.0 (only for the `./svelte` entry)

## License

MIT
