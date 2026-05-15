import { Global, Module } from '@nestjs/common';

import { CONFIG_TOKEN, loadConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG_TOKEN, useFactory: loadConfig }],
  exports: [CONFIG_TOKEN],
})
export class AppConfigModule {}
