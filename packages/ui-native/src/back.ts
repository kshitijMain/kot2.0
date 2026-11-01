import { BackHandler, Platform } from 'react-native';

/** What "back" does on a screen; true when it was handled there (the app stays where it is). */
export type BackPress = () => boolean;

interface BrowserHistory {
  pushState(data: unknown, unused: string): void;
}

/** What the browser's back needs of the window (this package has no DOM types). */
interface PopTarget {
  addEventListener(type: 'popstate', listener: () => void): void;
}

/**
 * The browser's back (a swipe from the edge on an iPhone, the back button on Android) in the phone
 * web app (P9-28): while any screen handles back, the page keeps one history entry of its own in
 * front, so going back lands on the app, whose newest screen handles it, instead of leaving the
 * page. The app never goes back in the history itself: a back it did could arrive after a screen
 * that opened meanwhile and take the page away.
 */
class BrowserBack {
  /** The screens that handle back, the newest last. */
  private readonly stack: BackPress[] = [];
  /** Whether the app's entry is in front of the page in the history. */
  private guarded = false;
  private listening = false;

  constructor(
    private readonly history: BrowserHistory,
    private readonly target: PopTarget,
  ) {}

  add(handler: BackPress): () => void {
    this.listen();
    // A screen of its own, even if the same function handles back on another.
    const entry: BackPress = () => handler();
    this.stack.push(entry);
    this.guard();
    return () => {
      const index = this.stack.indexOf(entry);
      if (index !== -1) this.stack.splice(index, 1);
      // The entry stays: a back with no screen to handle it then does nothing, once.
    };
  }

  private guard(): void {
    if (this.guarded) return;
    this.history.pushState({ rpBack: true }, '');
    this.guarded = true;
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.target.addEventListener('popstate', () => {
      this.guarded = false;
      const top = this.stack.at(-1);
      if (top === undefined) return;
      top();
      // The screen closes as React renders next; until then, and for the screen under it, the
      // next back must land here too.
      if (this.stack.length > 0) this.guard();
    });
  }
}

let browserBack: BrowserBack | undefined;

/** For tests: the browser's back over the given history. */
export function createBrowserBack(
  history: BrowserHistory,
  target: PopTarget,
): (handler: BackPress) => () => void {
  const back = new BrowserBack(history, target);
  return (handler) => back.add(handler);
}

/**
 * Runs `handler` when the person goes back: Android's back button in the app, the browser's back
 * in the phone web app (P9-28). Returns what stops listening.
 */
export function onBackPress(handler: BackPress): () => void {
  if (Platform.OS === 'web') {
    const browser = globalThis as unknown as { history: BrowserHistory } & PopTarget;
    browserBack ??= new BrowserBack(browser.history, browser);
    return browserBack.add(handler);
  }
  const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
  return () => {
    subscription.remove();
  };
}
