import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  type CurrentSessionResponse,
  HTTP_DEVICE_TYPES,
  type LoginResponse,
  OverrideRequest,
  type OverrideResponse,
  PinLoginRequest,
  RefreshRequest,
  STAFF_DEVICE_TYPES,
  type StaffTilesResponse,
  UnlockStaffRequest,
} from '@rp/contracts';
import { ZodValidationPipe } from '../validation/zod-validation.pipe.js';
import { idleMsOf } from './activity.js';
import { authErrors } from './auth-errors.js';
import { AuthService } from './auth.service.js';
import { RequireCapability, RequireDevice, RequireSession } from './decorators.js';
import type { AuthenticatedDevice } from './device.js';
import type { AuthenticatedRequest, Principal } from './principal.js';
import { SessionService } from './session.service.js';

function deviceOf(request: AuthenticatedRequest): AuthenticatedDevice {
  if (request.device === undefined) throw authErrors.deviceNotRecognised();
  return request.device;
}

function principalOf(request: AuthenticatedRequest): Principal {
  if (request.principal === undefined) throw authErrors.unauthenticated();
  return request.principal;
}

/** Sign-in, sessions and manager overrides (AUTH-001 to AUTH-005, AUTH-011). */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Get('staff-tiles')
  @RequireDevice(HTTP_DEVICE_TYPES)
  staffTiles(@Req() request: AuthenticatedRequest): Promise<StaffTilesResponse> {
    return this.auth.staffTiles(deviceOf(request));
  }

  @Get('session')
  @RequireSession()
  currentSession(@Req() request: AuthenticatedRequest): Promise<CurrentSessionResponse> {
    return this.sessions.describe(principalOf(request), deviceOf(request));
  }

  @Post('pin-login')
  @HttpCode(200)
  @RequireDevice(STAFF_DEVICE_TYPES)
  pinLogin(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(PinLoginRequest)) body: PinLoginRequest,
  ): Promise<LoginResponse> {
    return this.auth.pinLogin(deviceOf(request), body);
  }

  @Post('refresh')
  @HttpCode(200)
  @RequireDevice(STAFF_DEVICE_TYPES)
  refresh(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(RefreshRequest)) body: RefreshRequest,
  ): Promise<LoginResponse> {
    return this.sessions.refresh(body.refreshToken, deviceOf(request), idleMsOf(request));
  }

  @Post('logout')
  @HttpCode(204)
  @RequireSession()
  logout(@Req() request: AuthenticatedRequest): Promise<void> {
    return this.auth.logout(principalOf(request));
  }

  @Post('override')
  @HttpCode(200)
  @RequireSession()
  override(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(OverrideRequest)) body: OverrideRequest,
  ): Promise<OverrideResponse> {
    return this.auth.grantOverride(principalOf(request), deviceOf(request), body);
  }

  @Post('unlock')
  @HttpCode(204)
  @RequireCapability('STAFF_MANAGE')
  unlock(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(UnlockStaffRequest)) body: UnlockStaffRequest,
  ): Promise<void> {
    return this.auth.unlock(principalOf(request), body.staffId);
  }
}
