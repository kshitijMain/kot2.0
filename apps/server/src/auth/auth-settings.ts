import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * The ⚙ settings of authentication (BRD §4, AUTH-001, AUTH-003, AUTH-005, AUTH-011). Their
 * validation and defaults live in the settings catalogue (`@rp/contracts` settings, P1-01a).
 */
export interface AuthSettings {
  /** AUTH-001: 4 by default, 6 when the owner requires it. */
  readonly pinLength: 4 | 6;
  /** AUTH-003: failures within the window that lock the login. */
  readonly lockoutMaxFailures: number;
  readonly lockoutWindowMinutes: number;
  readonly lockoutMinutes: number;
  /** SEC-009: login and override attempts per device per minute. */
  readonly attemptsPerMinutePerDevice: number;
  /** PC-S5: wrong PINs on one device within the window that stop it taking any. */
  readonly deviceLockoutMaxFailures: number;
  /** MOBILE-S3: the same on a table tablet, where they count against the tablet only. */
  readonly tabletLockoutMaxFailures: number;
  /** PC-S5: refuse easily guessed PINs when one is set. */
  readonly refuseEasyPins: boolean;
  /** AUTH-005: at most 15 minutes. */
  readonly accessTokenMinutes: number;
  /** AUTH-005: POS and waiter devices. */
  readonly inactivityMinutes: number;
  /** Manager browsers (dashboard): longer, they are personal devices. */
  readonly managerBrowserInactivityMinutes: number;
  /** Absolute session length, whatever the activity (one long shift). */
  readonly sessionMaxHours: number;
  /** AUTH-011: how long a manager's override approval can be used. */
  readonly overrideSeconds: number;
  /** AUTH-005: kitchen staff sign in individually instead of station mode. */
  readonly kitchenIndividualLogins: boolean;
  /** AUTH-007: how long a pairing code can be used. */
  readonly pairingCodeMinutes: number;
  /** AUTH-007: how long a device token lasts before the device signs a new challenge. */
  readonly deviceTokenMinutes: number;
}

/** Settings-table key of each setting, e.g. `auth.lockoutMaxFailures`. */
export function authSettingKey(name: keyof AuthSettings): string {
  return `auth.${name}`;
}

/** The authentication settings of a restaurant, read through the settings registry (P1-01a). */
@Injectable()
export class AuthSettingsService {
  constructor(
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Current values; a missing or invalid stored value falls back to its default. */
  async get(restaurantId: string): Promise<AuthSettings> {
    const values = await this.settings.snapshot(restaurantId);
    return {
      pinLength: values.get('auth.pinLength'),
      lockoutMaxFailures: values.get('auth.lockoutMaxFailures'),
      lockoutWindowMinutes: values.get('auth.lockoutWindowMinutes'),
      lockoutMinutes: values.get('auth.lockoutMinutes'),
      attemptsPerMinutePerDevice: values.get('auth.attemptsPerMinutePerDevice'),
      deviceLockoutMaxFailures: values.get('auth.deviceLockoutMaxFailures'),
      tabletLockoutMaxFailures: values.get('auth.tabletLockoutMaxFailures'),
      refuseEasyPins: values.get('auth.refuseEasyPins'),
      accessTokenMinutes: values.get('auth.accessTokenMinutes'),
      inactivityMinutes: values.get('auth.inactivityMinutes'),
      managerBrowserInactivityMinutes: values.get('auth.managerBrowserInactivityMinutes'),
      sessionMaxHours: values.get('auth.sessionMaxHours'),
      overrideSeconds: values.get('auth.overrideSeconds'),
      // PIN-only (ADR-0025): the kitchen signs in with its PIN like everyone else.
      kitchenIndividualLogins:
        values.get('auth.kitchenIndividualLogins') || this.config.authPinOnly,
      pairingCodeMinutes: values.get('auth.pairingCodeMinutes'),
      deviceTokenMinutes: values.get('auth.deviceTokenMinutes'),
    };
  }

  /** Forget cached values, e.g. after a test changed a setting directly. */
  invalidate(): void {
    this.settings.invalidate();
  }
}
