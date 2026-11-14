import { registerAlertKeepAlive } from '@rp/mobile-native';
import { AppRegistry } from 'react-native';
import { deviceSession } from './session';

/**
 * The task the alert service runs to keep the phone listening with the screen off (P2-06b). After
 * Android restarted the service in a new process, it is what starts the device session.
 */
export function registerBackgroundTasks(): void {
  registerAlertKeepAlive(AppRegistry.registerHeadlessTask, deviceSession);
}
