// Types for apk-checks.mjs, for the tests that check it.

/** Why a phone could never reach `address`, in plain words; null when it may. */
export function addressProblem(address: string): string | null;

/** The restaurant PC's addresses and certificate fingerprint built into a waiter app APK. */
export function builtInSettings(apk: Buffer): { servers: string[]; ca: string | null };

/** Whether a certificate's names cover `address` as a phone checks it. */
export function certificateCovers(names: string, address: string): boolean;
