#!/usr/bin/env node
// `npm init inertia-native`: runs `inertia-native init`, which adds
// inertia-native and @inertia-native/cli to the app.
import { main } from '@inertia-native/cli'

process.exitCode = await main(['init', ...process.argv.slice(2)])
