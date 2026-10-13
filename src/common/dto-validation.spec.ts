import { BadRequestException, ValidationPipe } from "@nestjs/common";
import type { ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CreateContractDTO } from "../contracts/dto/create-contract.dto.js";
import { UpdateContractDTO } from "../contracts/dto/update-contract.dto.js";
import { CreateNotificationDto } from "../notifications/dto/create-notifications.dto.js";
import { RegisterTokenDto } from "../notifications/dto/register-token.dto.js";
import { UpdateNotificationDto } from "../notifications/dto/update-notifications.dto.js";
import { CreateUserDto } from "../users/dto/create-user.dto.js";
import { UpdateUserDto } from "../users/dto/update-user.dto.js";
import { AddTrustedDto } from "../users/dto/add-trusted.dto.js";
import { CreateDocumentDto } from "../documents/dto/document.dto.js";

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
  secret_hash: "hash",
  blockchain_tx_id: "0xabc",
  accessor_id: "user_2qrstuvwxyz123456",
  validators: ["user_2aaaaaaaaaaaaaaa", "user_2bbbbbbbbbbbbbbb"],
};

describe("notification DTOs", () => {
  const notification = {
    userId: "user_2abcdefghijklmnop",
    title: "Contract update",
    message: "Your contract has been updated.",
    type: "contract_updated",
    scheduled_at: "2026-10-11T12:00:00Z",
    meta: { key: "value" },
    data: { contractId: "c1" },
  };

  it("accepts a create body using the table column names", async () => {
    await expect(
      validate(CreateNotificationDto, notification),
    ).resolves.toMatchObject(notification);
  });

  it("rejects an unknown notification type", async () => {
    await expect(
      validate(CreateNotificationDto, { ...notification, type: "spam" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts marking a notification as read", async () => {
    await expect(
      validate(UpdateNotificationDto, { is_read: true }),
    ).resolves.toEqual({ is_read: true });
  });

  it("rejects the legacy camelCase isRead field", async () => {
    await expect(
      validate(UpdateNotificationDto, { isRead: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("only lets the app change the read state", async () => {
    await expect(
      validate(UpdateNotificationDto, { is_read: true, title: "hijacked" }),
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
      validate(UpdateContractDTO, { status: "active" }),
    ).resolves.toMatchObject({ status: "active" });
  });
});

describe("user DTOs", () => {
  it("accepts a user matching the users table", async () => {
    await expect(
      validate(CreateUserDto, {
        email: "john.doe@example.com",
        first_name: "John",
        last_name: "Doe",
      }),
    ).resolves.toBeDefined();
  });

  it("rejects the non-existent full_name column", async () => {
    await expect(
      validate(CreateUserDto, {
        email: "john.doe@example.com",
        full_name: "John Doe",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not allow changing the user id", async () => {
    await expect(
      validate(UpdateUserDto, { id: "other" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("contract update defaults", () => {
  it("does not inject blockchain_network into a partial update", async () => {
    const result = await validate(UpdateContractDTO, { status: "active" });
    expect(result).not.toHaveProperty("blockchain_network");
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
    ["user id on create", CreateUserDto, { id: "user_x", email: "a@b.co" }],
    [
      "trusted owner_id",
      AddTrustedDto,
      { owner_id: "user_x", trusted_id: "user_y" },
    ],
    [
      "push token user_id",
      RegisterTokenDto,
      { token: "ExponentPushToken[a]", user_id: "user_x" },
    ],
    [
      "document owner",
      CreateDocumentDto,
      {
        id: "d1",
        title: "t",
        type: "contract",
        content: "c",
        owner: "user_x",
        docType: "document",
        status: "active",
        hash: "h",
      },
    ],
  ];

  it.each(cases)("rejects %s", async (_name, metatype, body) => {
    await expect(validate(metatype, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
