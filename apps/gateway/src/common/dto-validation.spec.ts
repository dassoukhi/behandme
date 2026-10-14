import { BadRequestException, ValidationPipe } from "@nestjs/common";
import type { ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CreateContractDTO } from "../contracts/dto/create-contract.dto.js";
import { UpdateContractDTO } from "../contracts/dto/update-contract.dto.js";
import {
  PushTokenDto,
  UpdateNotificationDto,
  UpdateNotificationPreferencesDto,
} from "../notifications/interface/dto/notification-inputs.dto.js";
import { EnsureProfileDto } from "../users/interface/dto/create-user.dto.js";
import { UpdateUserDto } from "../users/interface/dto/update-user.dto.js";
import { AddTrustedDto } from "../users/interface/dto/add-trusted.dto.js";

// Same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const validate = (metatype: ArgumentMetadata["metatype"], value: unknown) =>
  pipe.transform(value, { type: "body", metatype });

const contract = {
  name: "networks",
  description: "desc",
  accessor_id: "user_2qrstuvwxyz123456",
  validators: ["user_2aaaaaaaaaaaaaaa", "user_2bbbbbbbbbbbbbbb"],
};

describe("notification DTOs", () => {
  it("accepts marking a notification as read or unread", async () => {
    await expect(
      validate(UpdateNotificationDto, { read: true }),
    ).resolves.toEqual({ read: true });
    await expect(
      validate(UpdateNotificationDto, { read: false }),
    ).resolves.toEqual({ read: false });
  });

  it.each([
    ["the legacy is_read field", { is_read: true }],
    ["another field", { read: true, title: "hijacked" }],
    ["a non-boolean", { read: "yes" }],
  ])("rejects %s on update", async (_case, body) => {
    await expect(validate(UpdateNotificationDto, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("accepts Expo push tokens only", async () => {
    for (const token of [
      "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
      "ExpoPushToken[yyyyyyyyyyyyyyyyyyyy]",
    ]) {
      await expect(validate(PushTokenDto, { token })).resolves.toEqual({
        token,
      });
    }
    for (const token of ["", "abc", "ExponentPushToken[]", "fcm:token"]) {
      await expect(validate(PushTokenDto, { token })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it("accepts a partial preferences update, booleans only", async () => {
    await expect(
      validate(UpdateNotificationPreferencesDto, { push_enabled: false }),
    ).resolves.toEqual({ push_enabled: false });
    await expect(
      validate(UpdateNotificationPreferencesDto, {}),
    ).resolves.toEqual({});
    await expect(
      validate(UpdateNotificationPreferencesDto, { push_enabled: "no" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("contract DTOs", () => {
  it("accepts validator ids longer than 3 characters", async () => {
    await expect(validate(CreateContractDTO, contract)).resolves.toMatchObject({
      validators: contract.validators,
    });
  });

  it("rejects more than 3 validators", async () => {
    await expect(
      validate(CreateContractDTO, {
        ...contract,
        validators: ["a", "b", "c", "d"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts a partial update", async () => {
    await expect(
      validate(UpdateContractDTO, { description: "updated" }),
    ).resolves.toMatchObject({ description: "updated" });
  });
});

describe("user DTOs", () => {
  it("accepts optional name overrides when ensuring a profile", async () => {
    await expect(
      validate(EnsureProfileDto, { first_name: "John", last_name: "Doe" }),
    ).resolves.toBeDefined();
    await expect(validate(EnsureProfileDto, {})).resolves.toBeDefined();
  });

  it.each([
    [
      "an email (comes from Clerk only)",
      EnsureProfileDto,
      { email: "victim@example.com" },
    ],
    [
      "an avatar url (comes from Clerk only)",
      EnsureProfileDto,
      { avatar_url: "https://x" },
    ],
    ["the user id", UpdateUserDto, { id: "other" }],
    ["an email on update", UpdateUserDto, { email: "victim@example.com" }],
    ["names on update (managed in Clerk)", UpdateUserDto, { first_name: "X" }],
  ])("rejects %s", async (_case, metatype, body) => {
    await expect(validate(metatype, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// Lifecycle and secret material are server-controlled: a client must never be
// able to set them, on create or on update.
describe("server-controlled contract fields are rejected", () => {
  const cases: [string, ArgumentMetadata["metatype"], object][] = [
    [
      "status on create",
      CreateContractDTO,
      { ...contract, status: "released" },
    ],
    ["status on update", UpdateContractDTO, { status: "released" }],
    [
      "secret_hash on create",
      CreateContractDTO,
      { ...contract, secret_hash: "h" },
    ],
    [
      "blockchain fields on create",
      CreateContractDTO,
      { ...contract, blockchain_tx_id: "0x" },
    ],
    ["meta on create", CreateContractDTO, { ...contract, meta: {} }],
    ["participants on update", UpdateContractDTO, { validators: ["user_x"] }],
    ["unknown category", CreateContractDTO, { ...contract, name: "bank" }],
    ["no validator", CreateContractDTO, { ...contract, validators: [] }],
    [
      "duplicate validators",
      CreateContractDTO,
      { ...contract, validators: ["a", "a"] },
    ],
  ];

  it.each(cases)("rejects %s", async (_name, metatype, body) => {
    await expect(validate(metatype, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// Identity always comes from the Clerk token: any body field that would let a
// client act as someone else must be rejected by the whitelist.
describe("identity fields are rejected in request bodies", () => {
  const cases: [string, ArgumentMetadata["metatype"], object][] = [
    [
      "contract owner_id on create",
      CreateContractDTO,
      { ...contract, owner_id: "user_x" },
    ],
    ["contract owner_id on update", UpdateContractDTO, { owner_id: "user_x" }],
    ["user id on profile ensure", EnsureProfileDto, { id: "user_x" }],
    [
      "trusted owner_id",
      AddTrustedDto,
      { owner_id: "user_x", trusted_id: "user_y" },
    ],
    [
      "push token user_id",
      PushTokenDto,
      { token: "ExponentPushToken[a]", user_id: "user_x" },
    ],
    [
      "preferences user_id",
      UpdateNotificationPreferencesDto,
      { push_enabled: true, user_id: "user_x" },
    ],
  ];

  it.each(cases)("rejects %s", async (_name, metatype, body) => {
    await expect(validate(metatype, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
