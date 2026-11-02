# Finance Tracker for iPhone

An Expo (React Native) app that signs in to your own Finance Tracker server and shows your
finances on the phone. It lives beside the server in this repository but is its own project, with
its own `package.json`, lockfile, lint and tests. The server's tools ignore this folder.

What it does so far (Phase 2 of the plan): sign in, see this month's budgets, sign out.

## How sign-in works

The app never sees your password. It asks for your server's address, checks
`GET /api/v1/server`, then opens your server's own sign-in page in the system sign-in sheet
(OAuth 2.0 for native apps with PKCE). You sign in there as on the web, with your password,
passkey or single sign-on, and press **Allow**. The server sends back a one-time code that the app
swaps for a device token (`ftd_…`), kept in the iPhone's Keychain on this device only. Each phone
shows under **Settings → Security → Signed-in apps** on the web, with Sign out.

The server side is `src/lib/app-devices.ts` and the `/api/v1/app/*` routes; the app side is
`src/utils/sign-in.ts` (pure, tested) and `src/session/`.

## Layout

| Folder | What is in it |
| --- | --- |
| `src/app/` | Expo Router routes only: `_layout.tsx`, `sign-in.tsx`, and `(tabs)/` with one stack per tab (`(home)`, `transactions`, `budgets`, `settings`) |
| `src/screens/` | What each route shows |
| `src/components/` | Pieces shared between screens: sections, progress bars, budget lines |
| `src/session/` | The stored sign-in (Keychain), the sign-in flow, the session provider |
| `src/api/` | Calls to the server's `/api/v1` routes, their types (`types.ts`), and the TanStack Query cache every screen reads through (`query.tsx`) |
| `src/utils/` | Plain functions with unit tests beside them |
| `src/state/` | Small app-wide state outside the server cache (the Undo offer after a delete) |
| `src/constants/theme.ts` | Colours and spacing, matching the web app |

## Checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

CI runs these, plus a Metro bundle of the iOS app, on every pull request (the `mobile` job in
`.github/workflows/test.yml`).

To try the app on a phone during development, `npx expo start` and a development build; Expo Go
does not include every native module this app may use later.

## TestFlight

Builds are made on EAS (Expo's cloud Macs) and sent to TestFlight. There is no App Store release;
the app is installed through TestFlight only.

**First build, once, by hand.** EAS will not create the Apple distribution certificate without
someone answering its prompts, so the very first build is run from a computer:

```bash
cd mobile
npm ci
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

It asks to log in to Expo, to create the EAS project, to log in to Apple (Apple ID and the
two-factor code) and to generate a distribution certificate and provisioning profile; say yes to
each. Before uploading it asks for the app's name on App Store Connect (any free name; the Home
Screen shows "Finances" either way) and which App Store Connect API key to use.

**After that,** run the **iOS TestFlight** workflow from the Actions tab on GitHub (Run workflow
on `main`). It needs the `EXPO_TOKEN` repository secret, the App Store Connect app id in
`eas.json` (`submit.production.ios.ascAppId`) and the EAS project id in `app.json`. Build numbers
go up by themselves (`autoIncrement`, kept on EAS).

The App Store Connect entry for the app was created by hand: Apple does not let an API key
create one, so `eas submit` gets a 403 if `ascAppId` is missing.

`.easignore` at the repository root limits what EAS uploads to this folder, so a local checkout's
databases and `.env` never leave the computer.

| Setting | Where | Value |
| --- | --- | --- |
| Bundle id | `app.json` `ios.bundleIdentifier` | `com.goodguy140.financetracker` |
| URL scheme (sign-in redirect) | `app.json` `scheme` | `financetracker`, must match `APP_REDIRECT_URI` on the server |
| Apple team | `eas.json` `submit.production.ios.appleTeamId` | `C5SNKYWDNZ` |
| App Store Connect app (Apple ID) | `eas.json` `submit.production.ios.ascAppId` | `6829763438` |
| EAS project | `app.json` `extra.eas.projectId` | `@goodguy140/finance-tracker` |
