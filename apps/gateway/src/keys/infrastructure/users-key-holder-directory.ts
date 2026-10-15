import { Injectable } from "@nestjs/common";
import { ProfileService } from "../../users/application/profile.service.js";
import { TrustService } from "../../users/application/trust.service.js";
import { displayName } from "../../users/domain/trust.js";
import type { KeyHolderDirectory } from "../application/ports.js";

/** The user's name and the people who trust them, from the users module. */
@Injectable()
export class UsersKeyHolderDirectory implements KeyHolderDirectory {
  constructor(
    private readonly profiles: ProfileService,
    private readonly trust: TrustService,
  ) {}

  async describe(
    userId: string,
  ): Promise<{ name: string | null; trusterIds: string[] }> {
    const [me, trusters] = await Promise.all([
      this.profiles.findMe(userId),
      this.trust.listTrustedBy(userId),
    ]);
    return { name: displayName(me), trusterIds: trusters.map((p) => p.id) };
  }
}
