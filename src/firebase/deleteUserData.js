/**
 * Firebase Cloud Function: Cleanup user data on account deletion.
 *
 * When a Firebase Authentication user is removed, we cascade delete any
 * Firestore documents that belong to that user: the user's profile, cart,
 * and orders. This ensures no orphaned personal data remains.
 *
 * Deploy with `firebase deploy --only functions` after adding the function
 * to your `firebase.json`/`functions` source configuration.
 */

import { onUserDeleted } from "firebase-functions/v2/auth";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Initialize the Admin SDK (will reuse existing app if already initialized).
initializeApp();
const db = getFirestore();

export const cleanupUserData = onUserDeleted(async (event) => {
  const uid = event.data.uid;
  console.log(`Cleaning up Firestore data for deleted user: ${uid}`);

  // Helper to delete a collection where a field matches the UID.
  const deleteCollectionWhere = async (path, field) => {
    const snapshot = await db.collection(path).where(field, "==", uid).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    console.log(`Deleted ${snapshot.size} documents from ${path}`);
  };

  // Delete user profile document (if stored under /users/{uid}).
  const userDocRef = db.collection("users").doc(uid);
  await userDocRef.delete().catch(() => {}); // ignore if not exists

  // Delete carts (could be /carts/{cartId} with userId field or nested under user).
  await deleteCollectionWhere("carts", "userId");
  // Also handle possible nested cart under user: /users/{uid}/cart/{itemId}
  const nestedCartRef = db.collection("users").doc(uid).collection("cart");
  const nestedCartSnap = await nestedCartRef.get();
  const batchNested = db.batch();
  nestedCartSnap.docs.forEach((doc) => batchNested.delete(doc.ref));
  await batchNested.commit();

  // Delete orders belonging to the user.
  await deleteCollectionWhere("orders", "userId");

  // Any other user‑scoped collections can be added here following the same pattern.
  return null;
});

