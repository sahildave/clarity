/**
 * The last user Clerk confirmed on this device, read synchronously from MMKV.
 *
 * The root navigator decides between sign-in and the app on its FIRST render.
 * Clerk's `isLoaded` needs a keychain read and, when online, a network round
 * trip, so it cannot answer that first frame. Before this flag existed the app
 * worked fully offline; a gate that waits on the network would put a login wall
 * in front of a user's own local data. So the first frame trusts this flag, and
 * Clerk confirms or revokes a moment later. A remotely revoked session sees the
 * app for a few hundred milliseconds. That data is theirs anyway.
 *
 * Written by the auth bridge when Clerk reports a user, cleared on sign-out.
 * Never written from a render.
 */

import { kv } from '@/services/kv';

const KEY = 'auth/userId';

/**
 * The user id RevenueCat has actually accepted, which is NOT the same fact as
 * the flag above.
 *
 * The sign-in flag has to be written the moment Clerk reports a user, because
 * the next launch's first frame reads it. `Purchases.logIn` can fail, and did
 * not use to leave a trace when it did: the bridge compared against the flag,
 * found it already current, and skipped the identify for the rest of the
 * install's life, leaving purchases on the anonymous id. This key records the
 * call that succeeded, so a failure retries.
 */
const PURCHASER_KEY = 'auth/purchaserId';

function readString(key: string): string | null {
  try {
    return kv.getString(key) ?? null;
  } catch {
    return null;
  }
}

function writeString(key: string, value: string | null, label: string): void {
  try {
    if (value) kv.set(key, value);
    else kv.remove(key);
  } catch (error) {
    console.warn(`[auth-state] could not persist ${label}`, error);
  }
}

export function getLastSignedInUserId(): string | null {
  return readString(KEY);
}

export function setLastSignedInUserId(userId: string | null): void {
  writeString(KEY, userId, 'sign-in flag');
}

export function getIdentifiedPurchaserId(): string | null {
  return readString(PURCHASER_KEY);
}

export function setIdentifiedPurchaserId(userId: string | null): void {
  writeString(PURCHASER_KEY, userId, 'purchaser id');
}
