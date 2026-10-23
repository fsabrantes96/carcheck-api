import type { Request } from 'express';

export interface JwtPayload {
    sub: string;
    email: string;
}

export type AuthenticatedRequest = Request & { user?: JwtPayload };