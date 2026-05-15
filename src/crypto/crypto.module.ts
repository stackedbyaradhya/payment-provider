import { Global, Module } from '@nestjs/common';

import { EnvKmsService, KmsService } from './kms.service';
import { TokenGenerator } from './token.generator';

@Global()
@Module({
  providers: [{ provide: KmsService, useClass: EnvKmsService }, TokenGenerator],
  exports: [KmsService, TokenGenerator],
})
export class CryptoModule {}
