# Finance Tracker iPhone app

This folder is the iPhone app for the Finance Tracker server in the parent directory, an Expo app
with its own `package.json` and lockfile. The server's lint, typecheck, tests and Docker image
ignore it. Read `README.md` here for how sign-in and TestFlight builds work.

- **Run every command from `mobile/`**: `npm run lint`, `npm run typecheck`, `npm test`. CI runs
  them in the `mobile` job of `.github/workflows/test.yml`, plus a Metro bundle of the iOS app.
- **Unit tests are vitest on plain TypeScript** (`src/utils/*.test.ts`), with
  `expect.requireAssertions` on like the server. Keep logic that needs testing out of React
  components and native modules, as `src/utils/sign-in.ts` does, so it runs in Node.
- **The app talks only to `/api/v1`** with a device token (`ftd_…`, `src/lib/app-devices.ts` on
  the server). A new screen that needs data the API does not have needs a server route first, with
  its own tests, in the same or an earlier pull request.
- **API changes only add.** Installed builds keep calling the routes they shipped with, and a
  phone can meet a server older than itself, so a field added to a response is optional in
  `src/api/types.ts` until every server has it. Screens read through `useApiQuery`
  (`src/api/query.tsx`), which signs the phone out on a 401 and empties the cache on sign-out.
- **The redirect `financetracker://signed-in` is shared** with the server's `APP_REDIRECT_URI`;
  change both or neither.
- **The home server's domain is never committed.** It reaches the build only through the EAS
  variable `HOME_SERVER_DOMAIN` (`app.config.ts`); tests use `finances.example.com`. Features
  that need the app and server paired (Face ID sign-in) check `isHomeServer`
  (`src/utils/home-server.ts`) and must keep working, without them, on every other server.
- **Swift in `app-intents/` and `passkeys/` is compiled into the app** (Expo inline modules,
  `experiments.inlineModules.watchedDirectories`): each module class is named after its file, and
  the app target is Swift 5 mode. Nothing here compiles Swift, so copy shapes from an Expo module
  that already builds (`node_modules/expo-*/ios`) and keep logic in tested TypeScript.
- **Never commit Apple or Expo credentials.** They live on EAS and in GitHub secrets
  (`EXPO_TOKEN`).
- `.easignore` at the repository root decides what EAS uploads. It leaves out everything outside
  `mobile/`; keep it that way.
- **A new app extension, App Group or capability needs one build by hand** (README → TestFlight):
  until then the workflow's non-interactive builds fail on credentials. Batch such changes, and
  check them before asking for that build: `npx expo prebuild -p ios --no-install` (the `ios/`
  folder is ignored), then `node node_modules/expo-widgets/scripts/build-bundle.mjs "$PWD"` and
  `build-layout-registry.mjs "$PWD" ios` for the widgets.
- **Widget bodies (`'widget'` in `src/widgets/`) run in iOS's widget process**, not the app: only
  their props and what they import from `@expo/ui/swift-ui`, `expo-widgets` and `react-native`
  exist there. Format everything in the app (`src/utils/widgets.ts`).
- **Widget props never hold null or undefined.** They are stored in UserDefaults, which takes only
  property-list values; a null in the props a widget starts with made the app crash on launch
  (build 12). Say "no data yet" with a flag (`ready: false`). `src/utils/widgets.test.ts` checks
  every prop. Files the widget layouts load (`src/widgets/*`) import each other by relative path
  only: `build-layout-registry.mjs` bundles them alone and resolves nothing else.

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
