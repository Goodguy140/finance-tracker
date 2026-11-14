/**
 * What the runtime version hashes (app.json `runtimeVersion`, the fingerprint policy), beyond
 * Expo's own list. Expo already covers native packages, config plugins and the app config, but not
 * code that is compiled into the build from these folders:
 *
 * - `app-intents/` and `passkeys/`: Swift inline modules (`experiments.inlineModules`).
 * - `src/widgets/`: the widget layouts, bundled into the widget extension when the app is built.
 * - `plugins/`: local config plugins, which change native code (the share extension's Swift).
 *
 * A change in one of them gives the next build a new runtime version, so an update published from
 * that code never reaches a build made before it. See README → Updates without a new build.
 *
 * @type {import('expo/fingerprint').Config}
 */
const config = {
  extraSources: [
    { type: 'dir', filePath: 'app-intents', reasons: ['Swift inline module'] },
    { type: 'dir', filePath: 'passkeys', reasons: ['Swift inline module'] },
    { type: 'dir', filePath: 'src/widgets', reasons: ['expo-widgets layouts'] },
    { type: 'dir', filePath: 'plugins', reasons: ['Local config plugins'] },
  ],
};

module.exports = config;
