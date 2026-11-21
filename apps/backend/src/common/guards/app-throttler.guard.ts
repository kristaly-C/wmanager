import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip =
      Array.isArray(req.ips) && req.ips.length > 0
        ? String(req.ips[0])
        : String(req.ip || 'unknown');

    const path = String(req.originalUrl || req.url || '').split('?')[0];

    if (path.endsWith('/auth/login')) {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      return email ? `login:${ip}:${email}` : `login:${ip}`;
    }

    if (path.endsWith('/auth/qr-login')) {
      return `qr:${ip}`;
    }

    if (req.user?.userId) {
      return `user:${req.user.userId}`;
    }

    return `ip:${ip}`;
  }
}
