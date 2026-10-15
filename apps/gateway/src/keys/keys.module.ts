import { Module } from "@nestjs/common";
import { systemClock } from "@lib/kernel";
import { UsersModule } from "../users/users.module.js";
import { KEYS_CLOCK, KeysService } from "./application/keys.service.js";
import { KEY_CRYPTOGRAPHY, KEY_REPOSITORY } from "./application/ports.js";
import { KyselyKeyRepository } from "./infrastructure/kysely-key.repository.js";
import { nodeKeyCryptography } from "./infrastructure/node-key-cryptography.js";
import { KeysController } from "./interface/keys.controller.js";

@Module({
  imports: [UsersModule],
  controllers: [KeysController],
  providers: [
    KeysService,
    { provide: KEY_REPOSITORY, useClass: KyselyKeyRepository },
    { provide: KEY_CRYPTOGRAPHY, useValue: nodeKeyCryptography },
    { provide: KEYS_CLOCK, useValue: systemClock },
  ],
})
export class KeysModule {}
