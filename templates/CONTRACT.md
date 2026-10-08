# Native shell templates — contract

`templates/ios/` and `templates/android/` are minimal Hotwire Native shells
shipped inside the `inertia-native` npm package. Server-side installers
(`php artisan inertia-native:install`, `bin/rails g inertia_native:install`)
copy them into an app and fill in a few values. No code generation, no file
renames.

## Copy

- `templates/ios/`     → `<app root>/ios/`
- `templates/android/` → `<app root>/android/`

Installers refuse to overwrite an existing target directory unless forced.

npm never publishes files named `.gitignore`, so templates ship them as
`gitignore`. Installers rename every file named exactly `gitignore` (at any
depth) to `.gitignore`. This is the only rename.

## Placeholders

Each template root has `inertia-native-template.json`:

```json
{ "version": 1, "files": ["relative/path/one", "relative/path/two"] }
```

Only the listed files contain placeholders. The installer replaces them in
those files and does **not** copy the manifest itself. Every other file is
copied byte-for-byte (this includes binaries such as the Gradle wrapper jar).

| Placeholder    | Meaning                         | Example                 |
| -------------- | ------------------------------- | ----------------------- |
| `__APP_NAME__` | Display name under the icon     | `Acme`                  |
| `__BUNDLE_ID__`| iOS bundle ID / Android appId   | `com.acme.app`          |
| `__BASE_URL__` | URL the app loads (no trailing `/`) | `http://localhost:8000` |

Installers validate input so that no escaping is ever needed:

- `__APP_NAME__`: `^[A-Za-z0-9][A-Za-z0-9 .-]{0,29}$`
- `__BUNDLE_ID__`: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$` (iOS rejects `_`,
  Android rejects `-`, so neither is allowed)
- `__BASE_URL__`: `^https?://[A-Za-z0-9.-]+(:\d+)?(/[A-Za-z0-9._~-]+)*$`
  (no trailing slash; no `$`, quotes or backslashes, since the value lands in
  Kotlin and Swift string literals)

Copies keep file modes: `gradlew` must stay executable.

## Behaviour both shells must have

- Load `__BASE_URL__` as the start location.
- Path configuration: bundled JSON in the app, plus the server copy at
  `__BASE_URL__/inertia-native/path-configuration/ios_v1.json` (iOS) or
  `.../android_v1.json` (Android). The server packages serve these routes.
- Local development over plain HTTP must work out of the box:
  - iOS simulator: `localhost` reaches the Mac.
  - Android emulator or USB phone: the base URL is loaded as is, so
    `localhost` must be forwarded with `adb reverse`; `inertia-native run
    android` does that for the app's port and the Vite dev server's. Debug
    builds allow cleartext to `localhost`, `127.0.0.1` and `10.0.2.2`.
- Register the bridge components that exist on both platforms.
- The user agent is Hotwire Native's default (`Hotwire Native iOS; ...` /
  `Hotwire Native Android; ...`); server packages detect the app with it.

## Fixed names

- iOS: `App.xcodeproj`, target `App`, scheme `App`. No signing team set.
  Display name and bundle ID are target build settings in `project.pbxproj`
  (editable in Xcode's General tab); the base URL lives in
  `App/AppConfig.swift`.
- Android: Kotlin package / Gradle `namespace` stays fixed; only
  `applicationId` takes `__BUNDLE_ID__`.

## Reference filler

`scripts/fill-template.mjs <ios|android> <dest> --name ... --bundle-id ... --url ...`
implements this contract in Node. Installers in PHP and Ruby must produce
byte-identical output.
