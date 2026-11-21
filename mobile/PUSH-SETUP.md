# Push notifications — one-time setup

New messages ring the phone even when the app is closed. The code is ready; Android needs **Firebase** and an
**installed app (APK)** — Expo Go can't receive push notifications (Expo SDK 53+).

What rings:

| New message | Who gets the notification | Tap opens |
| --- | --- | --- |
| Our team → customer (chat, quotes, order updates) | the customer (if they use the app) | their chat with us |
| Customer → our team | the agent who owns the chat — the whole team while unassigned | that chat |
| Personal chat | the other person | that chat |
| Our team → reseller (reseller thread) | the reseller's users | the request |
| Reseller → our team | the request's agent — the whole team while unassigned | the request |

Internal notes never notify, and nobody is notified about their own message. Signing a device out
(sign-out or **Linked devices**) stops its notifications.

## 1. Firebase (free)

1. Open <https://console.firebase.google.com> → **Create a project** (any name).
2. In the project: **Add app** → **Android**. Package name must be exactly the one in `app.json`
   (`android.package`, now `com.yourcompany.businessmessaging`). If you change the package name later
   (branding), add a new Android app in Firebase and download its file again.
3. Download **`google-services.json`** and put it in this `mobile` folder (next to `app.json`).
   `app.config.js` picks it up automatically. This file may be committed.
4. Firebase: **⚙ Project settings → Service accounts → Generate new private key → Generate key**.
   Keep the downloaded JSON **secret** — never commit it (`.gitignore` already excludes `*firebase-adminsdk*.json`).

## 2. Give the key to Expo

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest credentials
```

Choose **Android → production → Google Service Account → Manage your Google Service Account Key for Push
Notifications (FCM V1) → Set up a Google Service Account Key for Push Notifications (FCM V1) → Upload a new
service account key**, and pick the JSON from step 1.4.
(Or on expo.dev: **Project settings → Credentials → Android → FCM V1 service account key → Add a service account key**.)

## 3. Build and install the app

Double-click **`build-apk.bat`** (Expo cloud build, about 10–20 minutes), open the link on the phone, install.
In the installed app set the server address (e.g. `http://<your PC's Wi-Fi IP>:4000`) and sign in.
Allow notifications when asked.

## 4. Check

Sign in on the phone as a customer (e.g. `rahul@example.in`), **close the app**, then from the web app as an
agent send that customer a message (Customers → Message). The phone should ring.

Backend options (`backend/.env`, optional):

- `EXPO_ACCESS_TOKEN` — only if you turn on *enhanced push security* on expo.dev.
- `EXPO_PUSH_URL` — for tests only (the e2e test `16-push` runs its own fake push service).
