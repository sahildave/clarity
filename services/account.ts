/**
 * The two account exits, in the one order that does not lose data.
 *
 * Sign-out clears the device so the next person to sign in on it does not
 * inherit this account's history. It is ordered:
 *
 *  1. RevenueCat first, while the identified app-user id is still current
 *     (`services/purchases.ts` says: forget on logout, never at launch).
 *  2. Clerk next, and a failure aborts here. The clear below is irreversible
 *     and the caller offers a retry, so a sign-out that did not happen must
 *     leave the account's data where it is: the alternative is a signed-in
 *     user staring at an empty history.
 *  3. Every account-scoped local store, last. Named clears, not `clearAll()`:
 *     the history store's `clearAll` drops the legacy-import guard on purpose,
 *     and on sign-out that guard is what stops this device's old
 *     `sessions.json` from being re-imported into a different account.
 *
 * Signing out flips the root guard, so the screen that called this is already
 * unmounted by the time step 3 runs. That is fine: this is a module function,
 * and an unmounted caller does not cancel a pending promise chain.
 *
 * Both exits suspend the sync layer before touching anything. The sync effects
 * are still mounted and still subscribed at that moment, and every clear here
 * notifies them; see `suspendSync` in `services/sync-state.ts` for what they
 * would otherwise put back.
 */

import { forgetPurchaser } from '@/services/purchases';
import { setIdentifiedPurchaserId, setLastSignedInUserId } from '@/services/auth-state';
import { clearAccountHistory } from '@/services/session-history';
import { resetSettings } from '@/services/settings';
import { clearSyncState, resumeSync, suspendSync } from '@/services/sync-state';
import { clearCustomPassages } from '@/services/user-passages';

export type SignOutFn = () => Promise<unknown>;

export function clearAccountData() {
  // First, and before any notification goes out: every clear below emits to the
  // sync layer's listeners.
  suspendSync();
  clearAccountHistory();
  clearCustomPassages();
  resetSettings();
  // Cursors go with the data they describe, or the next account on this
  // device would start its upload from another account's position.
  clearSyncState();
  setLastSignedInUserId(null);
  // `signOutAndClear` forgets the purchaser on the way out, so the next
  // sign-in on this device has to identify again.
  setIdentifiedPurchaserId(null);
}

export async function signOutAndClear(signOut: SignOutFn): Promise<void> {
  try {
    await forgetPurchaser();
  } catch (error) {
    // A failed logOut leaves RevenueCat on the old id until the next identify.
    // Not worth blocking the sign-out over.
    console.warn('[account] forgetPurchaser failed', error);
  }
  await signOut();
  clearAccountData();
}

/**
 * Account deletion, required by App Store guideline 5.1.1(v).
 *
 * `deleteRemote` removes the account's server-side data. It runs FIRST and a
 * failure aborts: deleting the Clerk user before the data would leave rows with
 * no owner left to delete them.
 *
 * The local clear is unconditional here, unlike sign-out. Sign-out holds the
 * data back when Clerk refuses, because the account still exists and the user
 * can retry. Once the Clerk user is deleted there is nothing left to retry
 * into, so this device's copy goes whether or not the sign-out call answered.
 *
 * For the same reason a failed sign-out is NOT a failed deletion: the account
 * is gone, and reporting a failure would offer a retry that can only fail. The
 * throw is swallowed here so the caller's error path stays honest.
 */
export async function deleteAccount(
  deleteRemote: () => Promise<void>,
  deleteUser: () => Promise<unknown>,
  signOut: SignOutFn,
): Promise<void> {
  // Before `deleteRemote`, not after: emptying the tables updates the reactive
  // queries the sync effects read, and they would re-push every local row into
  // the account being deleted.
  suspendSync();
  try {
    await deleteRemote();
    await deleteUser();
  } catch (error) {
    // Nothing was deleted, or only part of it was, and the account is still
    // signed in with its local data intact. Sync has to come back: the caller
    // offers a retry, and until then this is a working account.
    resumeSync();
    throw error;
  }
  try {
    await signOutAndClear(signOut);
  } catch (error) {
    console.warn('[account] sign-out after deletion failed', error);
  } finally {
    clearAccountData();
  }
}
