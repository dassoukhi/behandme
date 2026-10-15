import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { systemClock } from "@lib/kernel";
import { UsersModule } from "../users/users.module.js";
import { KEYS_CLOCK, KeysService } from "./application/keys.service.js";
import {
  KEY_CRYPTOGRAPHY,
  KEY_HOLDER_DIRECTORY,
  KEY_QUARANTINE,
  KEY_REPOSITORY,
  KEYS_UNIT_OF_WORK,
} from "./application/ports.js";
import { keyQuarantineMs } from "./domain/keys.js";
import { KyselyKeyRepository } from "./infrastructure/kysely-key.repository.js";
import { KyselyKeysUnitOfWork } from "./infrastructure/kysely-keys.unit-of-work.js";
import { nodeKeyCryptography } from "./infrastructure/node-key-cryptography.js";
import { UsersKeyHolderDirectory } from "./infrastructure/users-key-holder-directory.js";
import { KeysController } from "./interface/keys.controller.js";

@Module({
  imports: [UsersModule],
  controllers: [KeysController],
  providers: [
    KeysService,
    { provide: KEY_REPOSITORY, useClass: KyselyKeyRepository },
    { provide: KEY_CRYPTOGRAPHY, useValue: nodeKeyCryptography },
    { provide: KEYS_CLOCK, useValue: systemClock },
    { provide: KEYS_UNIT_OF_WORK, useClass: KyselyKeysUnitOfWork },
    { provide: KEY_HOLDER_DIRECTORY, useClass: UsersKeyHolderDirectory },
    {
      provide: KEY_QUARANTINE,
      useFactory: (config: ConfigService) =>
        keyQuarantineMs(
          config.get<string>("KEY_QUARANTINE_SECONDS_OVERRIDE"),
          config.get<string>("NODE_ENV"),
        ),
      inject: [ConfigService],
    },
  ],
  exports: [KeysService],
})
export class KeysModule {}
