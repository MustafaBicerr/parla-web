/**
 * Firebase başlatma — ES module (CDN).
 * site-config.js'den sonra, diğer uygulama scriptlerinden önce yüklenmeli.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  remove,
  query,
  orderByChild,
  equalTo,
  limitToLast,
  onValue,
  off,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDuD32_PQrEoqq6T44JgpRRb2fbN6lde6U",
  authDomain: "parla-bt-web.firebaseapp.com",
  databaseURL: "https://parla-bt-web-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "parla-bt-web",
  storageBucket: "parla-bt-web.firebasestorage.app",
  messagingSenderId: "292866999248",
  appId: "1:292866999248:web:620aae16c3108e206dafd5",
  measurementId: "G-FZBYFFJF32",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

const firebaseApi = {
  app,
  auth,
  database,
  analytics: null,
  db: {
    ref,
    set,
    get,
    push,
    update,
    remove,
    query,
    orderByChild,
    equalTo,
    limitToLast,
    onValue,
    off,
    runTransaction,
  },
  authFn: {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    createUserWithEmailAndPassword,
    updatePassword,
  },
};

window.__PARLA_FIREBASE = firebaseApi;

isSupported().then(function (supported) {
  if (supported) {
    firebaseApi.analytics = getAnalytics(app);
  }
});
