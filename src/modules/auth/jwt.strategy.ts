import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { RequestContext } from '@/common/context/request-context';
import { UnauthorizedError } from '@/common/errors/domain-error';
import { AppConfig, CONFIG_TOKEN } from '@/config/configuration';

import { AuthService } from './auth.service';

export interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(CONFIG_TOKEN) config: AppConfig,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<{ id: string; email: string }> {
    const user = await this.auth.validateUser(payload.sub);
    if (!user) throw new UnauthorizedError('Invalid token');
    RequestContext.set('userId', user.id);
    return user;
  }
}
