# Finance Tracker for iPhone

An Expo (React Native) app that signs in to your own Finance Tracker server and shows your
finances on the phone. It lives beside the server in this repository but is its own project, with
its own `package.json`, lockfile, lint and tests. The server's tools ignore this folder.

What it does so far: sign in (with Face ID if you want it); see safe to spend, budgets and what is
due; post or skip recurring bills and pay; see your financial score and insights, your accounts,
net worth and each account's register; browse, search, add (with no connection too) and edit
transactions with receipts; share a receipt to it from Photos, Mail or Files; say "Log an expense
in Finances" to Siri; put safe to spend and the week's bills on the Home Screen; review what your
banks sent (the Review tab); connect and fix banks (Settings → Bank connections); and get bill,
charge and budget alerts (Settings → Alerts).
`docs/features.md` in the repository root lists it screen by screen.

## How sign-in works

The app never sees your password. It asks for your server's address, checks
`GET /api/v1/server`, then opens your server's own sign-in page in the system sign-in sheet
(OAuth 2.0 for native apps with PKCE). You sign in there as on the web, with your password,
passkey or single sign-on, and press **Allow**. The server sends back a one-time code that the app
swaps for a device token (`ftd_…`), kept in the iPhone's Keychain on this device only. Each phone
shows under **Settings → Security → Signed-in apps** on the web, with Sign out.

The server side is `src/lib/app-devices.ts` and the `/api/v1/app/*` routes; the app side is
`src/utils/sign-in.ts` (pure, tested) and `src/session/`.

### Face ID with a passkey, on the home server

A build can be made for one server, its **home server**. With that server, the sign-in screen
offers **Sign In with Face ID**: iOS's own passkey sheet, using a passkey added for that server on
the web (Settings → Security), with no browser sheet and no Allow page. The server checks it as
its login page does (`src/lib/app-passkey-sign-in.ts`, `POST /api/v1/app/passkey/options` and
`/token`) and answers with the same device token.

iOS lets an app use a domain's passkeys only when both sides name each other:

- the app's entitlements list `webcredentials:<domain>` (and `applinks:<domain>`, for bank
  sign-ins, below), which `app.config.ts` adds from **`HOME_SERVER_DOMAIN`** when building;
- the server serves `/.well-known/apple-app-site-association` naming the app, which it does only
  when **`APPLE_APP_ID`** is set (`C5SNKYWDNZ.com.goodguy140.financetracker`, the Team ID and the
  bundle id).

The domain is never written in this repository. Set it once on expo.dev → the project →
Environment variables: name `HOME_SERVER_DOMAIN`, value the server's domain (no `https://`),
environment **production**, visibility **Plain text** or **Sensitive** (not Secret: EAS reads it
on the computer that starts the build, where secrets are hidden). Builds without it work as before.

Every other server still works: the app signs in through its web page, and the sign-in screen says
that Face ID sign-in and connecting banks are not available there. The app and passkey code:
`passkeys/Passkeys.swift` (an inline module), `src/session/passkeys.ts`,
`src/utils/passkey-sign-in.ts` and `src/utils/home-server.ts`.

### Connecting banks in the app

Settings → Bank connections lists each bank, what it needs and where each of its accounts'
transactions go, on any server. On the home server it also connects a bank and fixes one (signing
in again, renewing access, sharing new accounts) with Plaid Link's iOS SDK
(`react-native-plaid-link-sdk`): Face ID first, with the same passkey, because the website asks
"Confirm it's you" before a bank connection too. The server's side is `src/lib/app-bank-link.ts`.

Many banks sign you in on their own site or app, then send you back to Plaid Link. On iOS that
return address must be an https link that opens the app: the server's `/plaid/oauth`, which its
app-site association hands to the app (`applinks:`), and which must also be added in the Plaid
dashboard's API settings under **Allowed redirect URIs** as `https://<domain>/plaid/oauth`.
Link picks the return up itself; the app only keeps the link from changing screen
(`src/utils/system-path.ts`). The app code: `src/screens/banks.tsx`, `src/session/bank-link.ts`
and `src/utils/banks.ts`.

## Layout

| Folder | What is in it |
| --- | --- |
| `src/app/` | Expo Router routes only: `_layout.tsx`, `sign-in.tsx`, and `(tabs)/` with one stack per tab (`(home)`, `transactions`, `review`, `budgets`, `settings`) |
| `src/screens/` | What each route shows |
| `src/components/` | Pieces shared between screens: sections, form rows, progress bars, budget lines, the Undo bar |
| `src/session/` | The stored sign-in (Keychain), the sign-in flow, the session provider |
| `src/notifications/` | Alerts: asking iOS, registering the phone's Apple push token with the server, and opening the right screen when one is tapped |
| `src/api/` | Calls to the server's `/api/v1` routes, their types (`types.ts`), and the TanStack Query cache every screen reads through (`query.tsx`) |
| `src/widgets/` | The Home Screen widgets (`'widget'` components run by iOS, not the app) and `update.ts`, which writes Home's numbers to them |
| `src/launch/` | What opens the app on a screen from outside it: a receipt shared from another app, Siri |
| `app-intents/` | Swift for Siri and the Shortcuts app ("Log an expense"), compiled into the app (Expo inline modules) |
| `passkeys/` | Swift for Face ID sign-in with a passkey (`ASAuthorizationController`), compiled into the app the same way |
| `app.config.ts` | `app.json` plus the home server (`HOME_SERVER_DOMAIN`, see How sign-in works) |
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

**Again by hand when the app gains an extension or a capability.** Associated Domains (Face ID
sign-in, from `HOME_SERVER_DOMAIN`) is one; so are the share sheet and the widgets, app
extensions with their own bundle ids
(`com.goodguy140.financetracker.expo-sharing-extension` and `….ExpoWidgetsTarget`), and all three
share the App Group `group.com.goodguy140.financetracker`. EAS registers those with Apple and makes
their provisioning profiles only while someone is logged in to Apple, so after such a change the
workflow fails on credentials until one build is run from a computer as above (`git pull` first:
a build from a computer uploads that checkout, not `main`). Workflow builds work again after it.

The App Store Connect entry for the app was created by hand: Apple does not let an API key
create one, so `eas submit` gets a 403 if `ascAppId` is missing.

`.easignore` at the repository root limits what EAS uploads to this folder, so a local checkout's
databases and `.env` never leave the computer.

| Setting | Where | Value |
| --- | --- | --- |
| Bundle id | `app.json` `ios.bundleIdentifier` | `com.goodguy140.financetracker` |
| Home server (Face ID sign-in) | EAS environment variable `HOME_SERVER_DOMAIN` (production) | The server's domain; never committed |
| App Group (app, share sheet, widgets) | `expo-sharing` and `expo-widgets` defaults | `group.com.goodguy140.financetracker` |
| URL scheme (sign-in redirect) | `app.json` `scheme` | `financetracker`, must match `APP_REDIRECT_URI` on the server |
| Apple team | `eas.json` `submit.production.ios.appleTeamId` | `C5SNKYWDNZ` |
| App Store Connect app (Apple ID) | `eas.json` `submit.production.ios.ascAppId` | `6829763438` |
| EAS project | `app.json` `extra.eas.projectId` | `@goodguy140/finance-tracker` |
