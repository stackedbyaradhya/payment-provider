export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  logLevel: string;
  corsOrigins: string[];
  database: { url: string };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  cardEncryption: {
    keyBase64: string;
    keyVersion: number;
  };
  mockBank: {
    deterministic: boolean;
    minLatencyMs: number;
    maxLatencyMs: number;
  };
  rateLimit: {
    generalTtlSeconds: number;
    generalLimit: number;
    paymentsTtlSeconds: number;
    paymentsLimit: number;
  };
  idempotency: { ttlHours: number };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Env var ${name} must be an integer`);
  return parsed;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
  }

  // Card encryption key must be exactly 32 bytes when decoded (AES-256-GCM).
  const keyBase64 = required('CARD_ENCRYPTION_KEY');
  const keyBytes = Buffer.from(keyBase64, 'base64');
  if (keyBytes.length !== 32) {
    throw new Error(`CARD_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${keyBytes.length})`);
  }

  const config: AppConfig = {
    nodeEnv,
    port: optionalInt('PORT', 3000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    database: { url: required('DATABASE_URL') },
    jwt: {
      accessSecret: required('JWT_ACCESS_SECRET'),
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshSecret: required('JWT_REFRESH_SECRET'),
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    },
    cardEncryption: {
      keyBase64,
      keyVersion: optionalInt('CARD_ENCRYPTION_KEY_VERSION', 1),
    },
    mockBank: {
      deterministic: optionalBool('MOCK_BANK_DETERMINISTIC', false),
      minLatencyMs: optionalInt('MOCK_BANK_MIN_LATENCY_MS', 100),
      maxLatencyMs: optionalInt('MOCK_BANK_MAX_LATENCY_MS', 3000),
    },
    rateLimit: {
      generalTtlSeconds: optionalInt('RATE_LIMIT_GENERAL_TTL_SECONDS', 60),
      generalLimit: optionalInt('RATE_LIMIT_GENERAL_LIMIT', 60),
      paymentsTtlSeconds: optionalInt('RATE_LIMIT_PAYMENTS_TTL_SECONDS', 60),
      paymentsLimit: optionalInt('RATE_LIMIT_PAYMENTS_LIMIT', 10),
    },
    idempotency: { ttlHours: optionalInt('IDEMPOTENCY_TTL_HOURS', 24) },
  };

  if (config.mockBank.minLatencyMs > config.mockBank.maxLatencyMs) {
    throw new Error('MOCK_BANK_MIN_LATENCY_MS must be <= MOCK_BANK_MAX_LATENCY_MS');
  }

  return config;
}

export const CONFIG_TOKEN = Symbol('AppConfig');
