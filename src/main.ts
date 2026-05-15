import 'reflect-metadata';
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfig, CONFIG_TOKEN } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<AppConfig>(CONFIG_TOKEN);

  // Helmet's default CSP forbids inline scripts, which breaks Swagger UI's
  // bootstrap. We allow inline + data: only for the assets Swagger needs
  // and keep every other helmet header (HSTS, X-Frame-Options, etc.).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
          imgSrc: ["'self'", 'data:', 'https://validator.swagger.io'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'https:', 'data:'],
        },
      },
    }),
  );
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  setupSwagger(app);

  const port = config.port;
  await app.listen(port);
  app.get(Logger).log({ port, env: config.nodeEnv }, 'Payments API listening');
}

function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('Payment Provider API')
    .setDescription(
      'Payment Provider backend. Card data is encrypted at rest; PAN never appears in responses or logs.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotency')
    .build();
  const document = SwaggerModule.createDocument(app, builder);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
