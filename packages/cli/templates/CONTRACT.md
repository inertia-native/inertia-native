# Native app templates

`templates/ios/` and `templates/android/` are minimal Hotwire Native apps.
`inertia-native init` copies them to the app's `ios/` and `android/` and
fills in a few values (`bin/shell.mjs`). Keep these rules when changing them.

## Placeholders

Each template has an `inertia-native-template.json` that lists the files
with placeholders:

```json
{ "version": 1, "files": ["App/AppConfig.swift", "App.xcodeproj/project.pbxproj"] }
```

`init` replaces the placeholders in those files and doesn't copy the manifest.
Every other file is copied byte for byte, file modes included (`gradlew` must
stay executable).

| Placeholder     | Meaning                             | Example                 |
| --------------- | ----------------------------------- | ----------------------- |
| `__APP_NAME__`  | Display name under the icon         | `Acme`                  |
| `__BUNDLE_ID__` | iOS bundle ID / Android appId       | `com.acme.app`          |
| `__BASE_URL__`  | URL the app loads (no trailing `/`) | `http://localhost:8000` |

## Validation

`init` validates the values so that they never need escaping:

- `__APP_NAME__`: `^[A-Za-z0-9][A-Za-z0-9 .-]{0,29}$`
- `__BUNDLE_ID__`: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$` (iOS rejects `_`,
  Android rejects `-`, so neither is allowed)
- `__BASE_URL__`: `^https?://[A-Za-z0-9.-]+(:\d+)?(/[A-Za-z0-9._~-]+)*$`
  (no trailing slash; no `$`, quotes or backslashes, since the value lands in
  Kotlin and Swift string literals)

## gitignore

npm never publishes files named `.gitignore`, so the templates ship them as
`gitignore`. `init` renames every file named exactly `gitignore` to
`.gitignore`. This is the only rename.

## Fixed names

- iOS: `App.xcodeproj`, target `App`, scheme `App`, no signing team. The
  display name and bundle ID are target build settings in `project.pbxproj`;
  the base URL lives in `App/AppConfig.swift`.
- Android: the Kotlin package and Gradle `namespace` stay
  `dev.inertianative.app`; only `applicationId` takes `__BUNDLE_ID__`.
  `inertia-native run android` launches the app's launcher activity.
  The Gradle root project is always `android`, so the app name never has to
  be a valid Gradle project name.

## Third-party code

Code taken from other projects keeps a header naming its source, and its
license (full text) goes in the template's `THIRD_PARTY_NOTICES`, which
`init` copies with the rest.

## Android JDK

Gradle runs on whatever JDK `JAVA_HOME` (or Android Studio) points at, 17 or
newer. The template pins no daemon JVM (`gradle-daemon-jvm.properties`) and
applies no toolchain resolver, so Gradle never downloads a JDK.
