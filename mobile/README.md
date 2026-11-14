# Business Messaging — mobile app (React Native / Expo)

One app for **your team** (admins & agents) and **resellers**. After sign-in it opens the right experience for the role:

| Team (admin / agent) | Reseller |
| --- | --- |
| **Overview** – live counts, alerts, reminders, workload | **My requests** – needs action / active / closed |
| **Chats** – customer & business inboxes, filters, search | Accept · decline · ask a question |
| Chat screen – reply to customer **or** internal note, saved replies (`/`), attachments, retry failed sends | Submit / revise quotes |
| Chat details – assign agent, status, priority, labels, reclassify, company, requests, orders, cases, follow-ups | Fulfilment updates (in progress → dispatched) |
| **Requests** – workspace with Details / Reseller thread / Customer thread / Quote & order | Messages with your team |
| Assign / reassign resellers (ranked matches), send quote with margin, record approval, update orders | **Orders** · **Account** (availability) |
| **Orders**, **More** → Resellers (verify, approve, suspend), Mediation (evidence, remedy approval, resolve, reopen) | |

It uses the same server, logins and data as the web app in the parent folder — every permission is enforced by that server.

## Easiest: run it in your computer's browser

No phone, QR code or Wi-Fi needed. In the main (parent) folder:

```bash
npm run dev
```

Open **http://localhost:3000/mobile-preview** — the app appears inside a phone frame (or **http://localhost:3000/m** full screen). Sign in with a demo account (password `demo123`).

After changing code in this `mobile` folder, refresh that build with `npm run mobile:web` (run in the parent folder).

## Run on an Android phone over USB (developer mode) — recommended

No Wi-Fi or firewall setup needed; everything goes through the USB cable.

1. Phone: **Settings → About phone → tap "Build number" 7 times** (turns on Developer options).
2. Phone: **Settings → Developer options → USB debugging = ON**.
3. Computer: download **SDK Platform-Tools for Windows** (developer.android.com/tools/releases/platform-tools) and unzip to `C:\platform-tools`.
4. Connect the phone by USB, tap **Allow** on the "Allow USB debugging?" popup.
5. Double-click **`run-android-usb.bat`** in this folder. It starts the server, creates the USB tunnel (`adb reverse`), and opens the app in Expo Go (installs it if missing).
6. In the app set **Server address** to `http://localhost:3000` and tap a demo account.

## Run it on your phone over Wi-Fi (development)

1. Start the web server on your computer (parent folder): `npm run dev`
2. Find your computer's Wi-Fi IP (Windows: `ipconfig` → *IPv4 Address*, e.g. `192.168.1.10`).
3. In this `mobile` folder:
   ```bash
   npm install
   npx expo start
   ```
4. Install **Expo Go** on your phone, scan the QR code (phone and computer on the same Wi-Fi).
5. On the login screen set **Server address** to `http://<your-IP>:3000`, then tap a demo account (password `demo123`).

> If the phone can't connect, allow Node.js through Windows Firewall (private networks) for port 3000.

Tip: set `EXPO_PUBLIC_API_URL=http://192.168.1.10:3000` in a `.env` file to pre-fill the server address.

## Build an installable app

Uses Expo's cloud build service (EAS) — no Android Studio/Xcode needed:

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview   # APK you can install/share
npx eas-cli@latest build -p ios --profile production    # needs an Apple Developer account
```

Before building, put your live **https** server address in `eas.json` (`EXPO_PUBLIC_API_URL`) and change `ios.bundleIdentifier` / `android.package` and the app name/icons in `app.json`.

## How it works

- `src/lib/store.tsx` – sign-in, session token stored in the device keychain (expo-secure-store), polling `/api/state` every 4 s while the app is open, `act()` for every change (same actions as the web app).
- `src/lib/types.ts`, `src/lib/format.ts` – shared with the web app (copied from `../lib`). Keep them in sync when the data model changes.
- `src/components/Thread.tsx` – message list + composer that shows who will receive the message before sending.
- `src/app/(team)/…` team screens, `src/app/portal/…` reseller screens (Expo Router, file-based).

Server change made for mobile: `/api/auth/login` also returns a `token`, and the API accepts `Authorization: Bearer <token>` (the web app keeps using its cookie).

## Not in this version (next steps)
- **Push notifications** when the app is closed (needs Expo push tokens saved on the server + sending on new messages/assignments). Today, badges and alerts update live while the app is open.
- Adding resellers/team members, settings and CSV export stay in the web app.
- Offline queue for actions taken without signal.
