import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_APNS_BUNDLE_ID, resolveApnsSettings } from "./apns-settings";

const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const form = { keyRaw: "", keyIdRaw: "abc123defg", teamIdRaw: "TEAM123456", bundleIdRaw: "", existingKey: key };

describe("resolveApnsSettings", () => {
  it("keeps the saved key when the field is left blank, and fills in the app's bundle ID", () => {
    expect(resolveApnsSettings(form)).toEqual({
      ok: true,
      values: { key, keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: DEFAULT_APNS_BUNDLE_ID },
      keyReplaced: false,
    });
    expect(resolveApnsSettings({ ...form, keyRaw: `\n${key}\n`, existingKey: "" })).toMatchObject({ ok: true, keyReplaced: true });
  });

  it("refuses what Apple would refuse, before anything is saved", () => {
    expect(resolveApnsSettings({ ...form, existingKey: "" })).toMatchObject({ ok: false });
    expect(resolveApnsSettings({ ...form, keyRaw: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" })).toMatchObject({
      ok: false,
    });
    expect(resolveApnsSettings({ ...form, keyIdRaw: "short" })).toMatchObject({ ok: false });
    expect(resolveApnsSettings({ ...form, bundleIdRaw: "not a bundle" })).toMatchObject({ ok: false });
  });
});
