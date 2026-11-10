import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Whether the device asks for reduced motion, so transitions can be left out (ADR-0028). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);
  return reduced;
}
