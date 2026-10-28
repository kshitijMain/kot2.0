import type { ApkUpdater, DeviceSession, OtaUpdater } from '@rp/mobile-core';
import { StartupFailed } from '@rp/mobile-shell';
import { useEffect, useState } from 'react';
import { App } from './App';
import { apkUpdater, appUpdater, deviceSession, notifier, translator } from './session';

/**
 * The screen of the waiter app. The device session is not the screen's: it goes on when the screen
 * is taken down, so the phone keeps alerting (P2-06b). Over-the-air updates start with the screen
 * (P7-04e1), and so does the APK updater (P7-04e2); without them the app still works.
 */
export function Root() {
  const [started, setStarted] = useState<{
    session: DeviceSession;
    updater: OtaUpdater | undefined;
    apkUpdater: ApkUpdater | undefined;
  } | null>(null);
  // A start that failed (secure storage, a native module) says so with Try again (NFR-U04).
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      deviceSession(),
      appUpdater().catch(() => undefined),
      apkUpdater().catch(() => undefined),
    ]).then(
      ([session, updater, apk]) => {
        if (mounted) setStarted({ session, updater, apkUpdater: apk });
      },
      () => {
        if (mounted) setFailed(true);
      },
    );
    return () => {
      mounted = false;
    };
  }, [attempt]);
  if (failed) {
    return (
      <StartupFailed
        translator={translator}
        onRetry={() => {
          setFailed(false);
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  return started === null ? null : (
    <App
      session={started.session}
      translator={translator}
      notifications={notifier}
      opener={notifier}
      {...(started.updater !== undefined && { updater: started.updater })}
      {...(started.apkUpdater !== undefined && { apkUpdater: started.apkUpdater })}
    />
  );
}
