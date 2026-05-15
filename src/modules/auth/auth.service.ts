import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { RequestContext } from '@/common/context/request-context';
import { ConflictError, UnauthorizedError, ValidationError } from '@/common/errors/domain-error';
import { AppConfig, CONFIG_TOKEN } from '@/config/configuration';
import { TokenGenerator } from '@/crypto/token.generator';
import { PrismaService } from '@/prisma/prisma.service';

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tokenGen: TokenGenerator,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async register(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictError('Email is already registered');

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: { email: normalizedEmail, passwordHash },
      select: { id: true, email: true },
    });

    const tokens = await this.issueTokens(user.id);
    return { user, tokens };
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, passwordHash: true },
    });
    // Run hash verify in both branches to avoid trivial timing attacks.
    const matched = user
      ? await argon2.verify(user.passwordHash, password).catch(() => false)
      : await argon2
          .verify(
            '$argon2id$v=19$m=65536,t=3,p=4$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000',
            password,
          )
          .catch(() => false);
    if (!user || !matched) throw new UnauthorizedError('Invalid credentials');

    const tokens = await this.issueTokens(user.id);
    return { user: { id: user.id, email: user.email }, tokens };
  }

  async refresh(refreshToken: string): Promise<IssuedTokens> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }
    const tokenHash = hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (record.userId !== payload.sub) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Rotation: revoke the used token and issue a new pair.
    await this.prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(payload.sub);
  }

  async validateUser(userId: string): Promise<{ id: string; email: string } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
  }

  private async issueTokens(userId: string): Promise<IssuedTokens> {
    const accessTtlSeconds = parseTtl(this.config.jwt.accessTtl);
    const refreshTtlSeconds = parseTtl(this.config.jwt.refreshTtl);

    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.jwt.accessSecret,
        expiresIn: accessTtlSeconds,
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, tokenId: this.tokenGen.refreshToken() },
      {
        secret: this.config.jwt.refreshSecret,
        expiresIn: refreshTtlSeconds,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
      },
    });

    RequestContext.set('userId', userId);
    return { accessToken, refreshToken, accessTokenExpiresIn: accessTtlSeconds };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseTtl(ttl: string): number {
  // Accepts forms like "15m", "7d", "3600s", or a plain number of seconds.
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) {
    const asNumber = Number(ttl);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
    throw new ValidationError(`Invalid TTL: ${ttl}`);
  }
  const value = Number(m[1]);
  const unit = m[2];
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * multiplier;
}
