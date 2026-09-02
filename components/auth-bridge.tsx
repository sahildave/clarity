import { useAuth } from '@clerk/expo';
import { useEffect } from 'react';

import {
  getIdentifiedPurchaserId,
  getLastSignedInUserId,
  setIdentifiedPurchaserId,
  setLastSignedInUserId,
} from '@/services/auth-state';
import { setAuthState } from '@/services/observe-events';
import { forgetPurchaser, identifyPurchaser } from '@/services/purchases';

/**
 * Renders nothing. Keeps the synchronous sign-in flag, RevenueCat's identity,
 * and the Observe auth attribute in step with Clerk.
 *
 * The flag is what the root navigator reads on its first frame, before Clerk
 * has loaded, so a returning user lands in the app offline exactly as they did
 * before accounts existed.
 *
 * RevenueCat identity follows the rule in `services/purchases.ts`: identify
 * right after a NEW login (so anonymous purchases transfer), forget on logout,
 * and never at launch. It is decided against its OWN stored id rather than the
 * sign-in flag: the flag is written the moment Clerk answers, so a `logIn` that
 * failed used to look already-done on every later pass and never ran again.
 * A cold start with a cached session identifies nothing, because that id is
 * already the identified one.
 */
export function AuthBridge() {
  const { isLoaded, isSignedIn, userId } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    const current = isSignedIn && userId ? userId : null;
    const previous = getLastSignedInUserId();
    setLastSignedInUserId(current);
    setAuthState(current ? 'signed-in' : 'signed-out');

    if (current) {
      // Not on the first pass of a launch: `isLoaded` is false until Clerk has
      // read the keychain, by which point `SubscriptionProvider` has already
      // configured RevenueCat and `identifyPurchaser` can do real work.
      if (getIdentifiedPurchaserId() !== current) {
        identifyPurchaser(current)
          .then((customerInfo) => {
            // null means purchases are unavailable in this build, so nothing
            // was linked and the marker stays clear for the next attempt.
            if (customerInfo) setIdentifiedPurchaserId(current);
          })
          .catch((error) => console.warn('[auth] identifyPurchaser failed', error));
      }
    } else if (previous) {
      // A session revoked from outside the app. The in-app sign-out path has
      // already forgotten the purchaser before Clerk reports signed-out.
      setIdentifiedPurchaserId(null);
      forgetPurchaser().catch((error) => console.warn('[auth] forgetPurchaser failed', error));
    }
  }, [isLoaded, isSignedIn, userId]);

  return null;
}
