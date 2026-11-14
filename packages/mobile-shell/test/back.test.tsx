import { createBrowserBack } from '../src/index.js';

/** A browser's history: entries the page pushed, and its back. */
function fakeBrowser() {
  let pushed = 0;
  let listener: (() => void) | undefined;
  return {
    history: {
      pushState: () => {
        pushed += 1;
      },
    },
    target: {
      addEventListener: (_type: 'popstate', next: () => void) => {
        listener = next;
      },
    },
    /** The person goes back: the browser drops the newest entry and tells the page. */
    back: () => {
      pushed -= 1;
      listener?.();
    },
    pushed: () => pushed,
  };
}

describe('[P9-28] the browser’s back in the phone web app', () => {
  it('lands on the app while a screen handles back, and closes the newest screen', () => {
    const browser = fakeBrowser();
    const onBack = createBrowserBack(browser.history, browser.target);
    const closed: string[] = [];
    const stopTable = onBack(() => {
      closed.push('table');
      return true;
    });
    const stopMenu = onBack(() => {
      closed.push('menu');
      return true;
    });
    // One entry of the app's, however many screens.
    expect(browser.pushed()).toBe(1);
    browser.back();
    expect(closed).toEqual(['menu']);
    // The menu has not closed yet (React renders next): the next back lands here again.
    expect(browser.pushed()).toBe(1);
    stopMenu();
    browser.back();
    expect(closed).toEqual(['menu', 'table']);
    stopTable();
  });

  it('never goes back in the history itself when a screen closes in the app', () => {
    const browser = fakeBrowser();
    const onBack = createBrowserBack(browser.history, browser.target);
    for (let screen = 0; screen < 5; screen += 1) onBack(() => true)();
    // Screens opened and closed in the app: one entry stays, nothing taken from the history.
    expect(browser.pushed()).toBe(1);
    // A back with no screen open does nothing and adds nothing.
    browser.back();
    expect(browser.pushed()).toBe(0);
  });
});
