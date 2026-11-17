import { describe, expect, it } from "vitest";
import type { ClerkClient } from "@clerk/backend";
import { ClerkIdentityProvider } from "./clerk-identity.provider.js";

function providerFor(user: { hasImage: boolean; imageUrl: string }) {
  const clerk = {
    users: {
      getUser: () =>
        Promise.resolve({
          ...user,
          firstName: "Nina",
          lastName: "Martin",
          primaryEmailAddressId: "e1",
          emailAddresses: [
            {
              id: "e1",
              emailAddress: "nina@example.com",
              verification: { status: "verified" },
            },
          ],
        }),
    },
  } as unknown as ClerkClient;
  return new ClerkIdentityProvider(clerk);
}

describe("ClerkIdentityProvider", () => {
  it("keeps a photo the person chose", async () => {
    const profile = await providerFor({
      hasImage: true,
      imageUrl: "https://img.clerk.com/photo",
    }).getProfile("user_1");
    expect(profile.avatar_url).toBe("https://img.clerk.com/photo");
  });

  it("drops the image Clerk generates for someone with no photo, so that the app draws their initials", async () => {
    const profile = await providerFor({
      hasImage: false,
      imageUrl: "https://img.clerk.com/generated",
    }).getProfile("user_1");
    expect(profile).toMatchObject({
      avatar_url: null,
      email: "nina@example.com",
      email_verified: true,
    });
  });
});

describe("deleting the Clerk account", () => {
  const deleting = (outcome: () => Promise<unknown>) =>
    new ClerkIdentityProvider({
      users: { deleteUser: outcome },
    } as unknown as ClerkClient);

  it("says whether there was an account to delete, so that a wrong id is not taken for a closure", async () => {
    await expect(deleting(async () => ({})).deleteUser("user_1")).resolves.toBe(
      true,
    );
    await expect(
      deleting(() =>
        Promise.reject(Object.assign(new Error("Not Found"), { status: 404 })),
      ).deleteUser("user_x"),
    ).resolves.toBe(false);
    await expect(
      deleting(() =>
        Promise.reject(
          Object.assign(new Error("Unavailable"), { status: 503 }),
        ),
      ).deleteUser("user_1"),
    ).rejects.toThrow("Unavailable");
  });
});
