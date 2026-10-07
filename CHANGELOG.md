# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-07

First stable release. Upgrading from `0.1.0-beta.2`: rename
`initHotwireNative` to `initInertiaNative`, and make sure `@inertiajs/core` is
3.0 or newer.

### Changed

- **Breaking:** `initHotwireNative` is now `initInertiaNative`, and
  `InitHotwireNativeOptions` is `InitInertiaNativeOptions`. Debug logs are
  prefixed `[inertia-native]`.
- **Breaking:** requires `@inertiajs/core` 3.0 or newer. Support for v2 and its
  `invalid`/`exception` router events is dropped.
- `TurboShim`, `TurboNativeAdapter`, `NativeBridgeAdapter` and
  `VisitProposalOptions` are marked internal and may change in minor releases.

### Fixed

- An async visit (a poll, deferred props) that fails or gets a location visit
  while a native visit is in flight no longer fails that native visit. Errors
  are matched to the native visit through its own `onHttpException` /
  `onNetworkError` callbacks.

## [0.1.0-beta.2] — 2026-10-06

### Changed

- Renamed from `inertia-hotwire-native` to `inertia-native`, and the repository
  moved to [inertia-native/inertia-native](https://github.com/inertia-native/inertia-native).
  Update imports to `inertia-native` and `inertia-native/react`.

### Added

- Vue bindings (`inertia-native/vue`): `useBridgeComponent(name)` composable,
  with `supported` and `restored` as `Ref`s.
- Svelte bindings (`inertia-native/svelte`): `useBridgeComponent(name)` helper,
  with `supported` and `restored` as readable stores.
- React `useBridgeComponent` returns `restored`, bumped on `native:restore` (Android,
  back from a native screen), so a component can send `connect` again.
- `proposeFormRedirects` option: after a form lands on another URL, propose it
  to native as Turbo does, so a modal form can be dismissed to show its result.

### Fixed

- A native visit that gets a successful non-Inertia response (e.g. a classic
  Turbo page) now asks native to reload the web view (`pageInvalidated`)
  instead of showing an error screen.
- Location visits (409 + `X-Inertia-Location`) no longer navigate the web view
  behind native's back. An asset version mismatch reloads the screen, and an
  `inertia_location` redirect goes to native, which decides where it opens.
  Requires `@inertiajs/core` 3; on v2 Inertia still follows them itself.
- Partial reloads, async visits, `preserveState`/`preserveUrl` visits and
  visits to the current URL stay in the web view instead of opening a native
  screen, so `usePoll`, `<WhenVisible>`, `<InfiniteScroll>` and filters work.
- Prefetches are cancelled rather than proposed to native, which opened the
  link without a tap.
- An async visit (a poll, deferred props) finishing during a native visit no
  longer reports that visit as finished. Native visits now report through
  their own per-visit callbacks instead of router events.

## [0.1.0-beta.1] — 2026-07-25

### Fixed

- Restoring the first web page in a native stack no longer blanks the screen.
  Stepping back off our own history entries lands on Hotwire's bootstrap
  document, which the web view paints before any handler can react; the driver
  now counts the entries Inertia pushes and requests the page without touching
  history when nothing of ours is behind. (#2)
- A restore that lands on a non-Inertia entry, or on a URL other than the one
  asked for, is no longer reported as started, rendered and completed against a
  blank document — the page is fetched instead.

## [0.1.0-beta.0] — 2026-06-22

First public beta. Pre-1.0, the API may still change.

### Added

- `initHotwireNative()` — installs the `window.Turbo` shim that Hotwire Native's
  injected `turbo.js` drives, mapping the native adapter protocol onto Inertia's
  router (push/pop/replace/restore, modals, forms, error screens,
  pull-to-refresh). Inert in a regular browser.
- Web bridge runtime (`window.HotwireNative.web`) for native bridge components.
- React bindings (`inertia-hotwire-native/react`): `useBridgeComponent(name)`.
- Hand-written TypeScript declarations and a type-level test.
- Compatible with `@inertiajs/core` `>=2.0` (handles both the current and
  pre-3.4 router event names).
