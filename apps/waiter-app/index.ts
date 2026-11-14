// First: settings the browser build needs before any module builds a schema (P9-28).
import './src/web-setup';
import { registerRootComponent } from 'expo';
import { registerBackgroundTasks } from './src/background';
import { Root } from './src/Root';

// Registers the app as `main`, the name the native project starts (Expo development builds), or
// renders it into the page in a browser (P9-28).
registerRootComponent(Root);

// Android: the alert service's keep-alive task (P2-06b). A browser has none.
registerBackgroundTasks();
