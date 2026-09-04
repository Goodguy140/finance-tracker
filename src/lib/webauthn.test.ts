import { compare } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  mfaChallenge: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  webAuthnCredential: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  recoveryCode: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
};

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const swa = {
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
};
vi.mock("@simplewebauthn/server", () => swa);

process.env.NEXTAUTH_URL = "https://money.example.com";

const {
  consumeChallenge,
  createAuthenticationOptions,
  generateRecoveryCodes,
  redeemRecoveryCode,
  verifyAuthentication,
  verifyPasskeySignIn,
  MfaVerificationError,
} = await import("./webauthn");

const future = new Date(Date.now() + 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.5); // never trigger the opportunistic sweep
});

describe("consumeChallenge", () => {
  it("returns the challenge once and deletes it", async () => {
    db.mfaChallenge.findUnique.mockResolvedValue({ id: "c1", purpose: "authenticate", userId: "u1", challenge: "abc", expiresAt: future });
    db.mfaChallenge.deleteMany.mockResolvedValue({ count: 1 });
    expect(await consumeChallenge("c1", "authenticate", "u1")).toBe("abc");
    expect(db.mfaChallenge.deleteMany).toHaveBeenCalledWith({ where: { id: "c1", expiresAt: { gt: expect.any(Date) } } });
  });

  it("rejects a challenge minted for another purpose or user", async () => {
    db.mfaChallenge.findUnique.mockResolvedValue({ id: "c1", purpose: "register", userId: "u1", challenge: "abc", expiresAt: future });
    expect(await consumeChallenge("c1", "authenticate", "u1")).toBeNull();
    expect(await consumeChallenge("c1", "register", "u2")).toBeNull();
    expect(db.mfaChallenge.deleteMany).not.toHaveBeenCalled();
  });

  it("loses the race (or the expiry) when the delete removes nothing", async () => {
    db.mfaChallenge.findUnique.mockResolvedValue({ id: "c1", purpose: "signin", userId: null, challenge: "abc", expiresAt: future });
    db.mfaChallenge.deleteMany.mockResolvedValue({ count: 0 });
    expect(await consumeChallenge("c1", "signin", null)).toBeNull();
  });
});

describe("createAuthenticationOptions", () => {
  it("uses the RP from NEXTAUTH_URL, requires user verification, and lists no credential ids", async () => {
    swa.generateAuthenticationOptions.mockResolvedValue({ challenge: "chal" });
    db.mfaChallenge.create.mockResolvedValue({ id: "c9" });
    const { challengeId } = await createAuthenticationOptions("authenticate", "u1");
    expect(challengeId).toBe("c9");
    expect(swa.generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: "money.example.com",
      userVerification: "required",
      allowCredentials: [],
    });
    expect(db.mfaChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ purpose: "authenticate", userId: "u1", challenge: "chal" }) }),
    );
  });
});

describe("verifyAuthentication", () => {
  const stored = {
    id: "row1",
    userId: "u1",
    credentialId: "cred-1",
    publicKey: "AQID",
    counter: 3,
    transports: "internal,hybrid",
    user: { id: "u1", email: "a@b.c" },
  };

  beforeEach(() => {
    db.mfaChallenge.findUnique.mockResolvedValue({ id: "c1", purpose: "authenticate", userId: "u1", challenge: "chal", expiresAt: future });
    db.mfaChallenge.deleteMany.mockResolvedValue({ count: 1 });
    db.webAuthnCredential.findUnique.mockResolvedValue(stored);
  });

  it("refuses a passkey that belongs to a different user than the session", async () => {
    await expect(
      verifyAuthentication({ challengeId: "c1", response: { id: "cred-1" } as never, purpose: "authenticate", expectedUserId: "u2" }),
    ).rejects.toBeInstanceOf(MfaVerificationError);
    expect(swa.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("verifies against the stored key with the expected origin and bumps the counter", async () => {
    swa.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 4, credentialBackedUp: true },
    });
    db.webAuthnCredential.update.mockResolvedValue({ ...stored, counter: 4 });

    const result = await verifyAuthentication({
      challengeId: "c1",
      response: { id: "cred-1" } as never,
      purpose: "authenticate",
      expectedUserId: "u1",
    });
    expect(result.user.id).toBe("u1");
    expect(swa.verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: "chal",
        expectedOrigin: "https://money.example.com",
        expectedRPID: "money.example.com",
        requireUserVerification: true,
        credential: expect.objectContaining({ id: "cred-1", counter: 3, transports: ["internal", "hybrid"] }),
      }),
    );
    expect(db.webAuthnCredential.update).toHaveBeenCalledWith({
      where: { id: "row1" },
      data: { counter: 4, backedUp: true, lastUsedAt: expect.any(Date) },
    });
  });

  it("maps library failures to MfaVerificationError without touching the counter", async () => {
    swa.verifyAuthenticationResponse.mockRejectedValue(new Error("bad signature"));
    await expect(
      verifyAuthentication({ challengeId: "c1", response: { id: "cred-1" } as never, purpose: "authenticate", expectedUserId: "u1" }),
    ).rejects.toBeInstanceOf(MfaVerificationError);
    expect(db.webAuthnCredential.update).not.toHaveBeenCalled();
  });
});

describe("verifyPasskeySignIn", () => {
  it("returns null for malformed input instead of throwing into authorize", async () => {
    expect(await verifyPasskeySignIn("c1", "{not json")).toBeNull();
    expect(await verifyPasskeySignIn("c1", JSON.stringify({ nope: true }))).toBeNull();
  });
});

describe("recovery codes", () => {
  it("issues 8 formatted codes and stores only bcrypt hashes, replacing the old set", async () => {
    const codes = await generateRecoveryCodes("u1");
    expect(codes).toHaveLength(8);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(db.recoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    const stored = db.recoveryCode.createMany.mock.calls[0][0].data as { userId: string; codeHash: string }[];
    expect(stored).toHaveLength(8);
    expect(await compare(codes[0].replace("-", ""), stored[0].codeHash)).toBe(true);
    expect(stored.some((row) => row.codeHash.includes(codes[0]))).toBe(false);
  });

  it("redeems a matching code exactly once", async () => {
    const codes = await generateRecoveryCodes("u1");
    const rows = (db.recoveryCode.createMany.mock.calls[0][0].data as { codeHash: string }[]).map((r, i) => ({
      id: `r${i}`,
      codeHash: r.codeHash,
    }));
    db.recoveryCode.findMany.mockResolvedValue(rows);
    db.recoveryCode.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const normalized = codes[2].replace("-", "");
    expect(await redeemRecoveryCode("u1", normalized)).toBe(true);
    expect(db.recoveryCode.updateMany).toHaveBeenCalledWith({
      where: { id: "r2", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(await redeemRecoveryCode("u1", normalized)).toBe(false);
    expect(await redeemRecoveryCode("u1", "aaaaaaaaaa")).toBe(false);
  });
});
