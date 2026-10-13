import { describe, expect, it } from "vitest";
import { createSelfSigned } from "./cms";
import { openId, sealId } from "./ids";

describe("saved digital IDs", () => {
  it("keeps the private key encrypted and opens only with the password", async () => {
    const id = await createSelfSigned({ name: "Alex", kind: "ECDSA" });
    const saved = await sealId(id, "correct horse");
    expect(saved).not.toContain(btoa(String.fromCharCode(...id.pkcs8)).slice(0, 40));
    const back = await openId(saved, "correct horse");
    expect(back.pkcs8).toEqual(id.pkcs8);
    expect(back.cert).toEqual(id.cert);
    await expect(openId(saved, "wrong horse")).rejects.toThrow("doesn't open");
    await expect(openId('{"cert":1}', "x")).rejects.toThrow("damaged");
    await expect(sealId(id, "short")).rejects.toThrow("6 characters");
  }, 60_000);
});
