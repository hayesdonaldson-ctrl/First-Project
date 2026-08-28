// Cloud sync: Google sign-in + per-user task list in Firestore.
// Signed out, the app runs entirely on localStorage (see script.js).
// Signed in, each user's tasks live at lists/{uid} and sync live across devices.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCS_arONZzwzEerfJ6y0k1WbVJksUmsH_A",
  authDomain: "my-todo-list-a5242.firebaseapp.com",
  projectId: "my-todo-list-a5242",
  storageBucket: "my-todo-list-a5242.firebasestorage.app",
  messagingSenderId: "270027887589",
  appId: "1:270027887589:web:bc690196574b0b45a7550c",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Offline cache so the app works without a connection when signed in.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (_) {
  db = getFirestore(app);
}

const signInBtn = document.getElementById("sign-in");
const signOutBtn = document.getElementById("sign-out");
const authInfo = document.getElementById("auth-info");
const authEmail = document.getElementById("auth-email");
const statusEl = document.getElementById("sync-status");

function status(text) {
  if (statusEl) statusEl.textContent = text;
}

setPersistence(auth, browserLocalPersistence).catch(() => {});

let unsubscribe = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  window.__onTasksChanged = null;

  if (!user) {
    signInBtn.hidden = false;
    authInfo.hidden = true;
    authEmail.textContent = "";
    status("Not synced — sign in to sync across your devices");
    return;
  }

  signInBtn.hidden = true;
  authInfo.hidden = false;
  authEmail.textContent = user.email || user.displayName || "signed in";
  status("Syncing…");

  const ref = doc(db, "lists", user.uid);

  // First sign-in on a device: if the cloud list is empty, seed it from
  // whatever this device had locally. Otherwise the cloud list wins.
  try {
    const snap = await getDoc(ref);
    const cloudTasks = snap.exists() ? snap.data().tasks || [] : [];
    const localTasks = window.TodoApp.getTasks();
    if (cloudTasks.length === 0 && localTasks.length > 0) {
      await setDoc(ref, { tasks: localTasks, updatedAt: serverTimestamp() });
    }
  } catch (e) {
    status("Sync error: " + (e.code || e.message));
  }

  // Push local edits up.
  window.__onTasksChanged = (nextTasks) => {
    setDoc(ref, { tasks: nextTasks, updatedAt: serverTimestamp() }, { merge: true })
      .then(() => status("Synced ✓"))
      .catch((e) => status("Sync error: " + (e.code || e.message)));
  };

  // Pull changes from other devices in real time.
  unsubscribe = onSnapshot(
    ref,
    (d) => {
      if (!d.exists()) return;
      if (d.metadata.hasPendingWrites) return; // skip our own optimistic write
      window.TodoApp.applyRemoteTasks(d.data().tasks || []);
      status("Synced ✓");
    },
    (e) => status("Sync error: " + (e.code || e.message))
  );
});

signInBtn.addEventListener("click", () => {
  status("Opening Google sign-in…");
  signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => {
    status("Sign-in failed: " + (e.code || e.message));
  });
});

signOutBtn.addEventListener("click", () => {
  signOut(auth).catch(() => {});
});
