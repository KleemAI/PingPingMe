# Business Messaging app: tester handover

Nov 24, 2026

## What this app is

Business Messaging is an Android app that puts chat, groups, a P2P market, to-dos and reminders in one place. This is a **test build** (version 1.0.0): some parts are still unfinished, and your reports decide what gets fixed next.

This build includes:

- **Chat:** personal chats and groups, end-to-end encrypted (except groups with more than 1,000 members)
- **Groups and communities:** up to 200,000 members in one group
- **P2P market:** sell and buy items, orders, payment proof, and a ringing alert when a new order arrives
- **Digital products:** the seller can ask for the buyer's email, and a link or file is delivered automatically after payment
- **To-dos and reminders**

## Install the APK

The app is not on the Play Store, so you install it directly from an APK file. It works on Android phones only (not iPhone).

**Download link:** [Download the Business Messaging APK](https://expo.dev/artifacts/eas/E5XyQMN6Hlpj2rQPYIVyaMUto0K1o06qSzgILzjSwCw.apk) (the link works until about Dec 8, 2026). The same file is in this repository: [`releases/business-messaging-test-1.0.0.apk`](../releases/business-messaging-test-1.0.0.apk).

1. Open the link above in your phone's browser (Chrome). The file downloads (about 98 MB).
2. When the download finishes, tap the file.
3. If the phone asks about "Install unknown apps", tap **Settings**, turn on **Allow from this source** for Chrome, and go back.
4. Tap **Install**.
5. If you see a "Play Protect" or "Unsafe app" warning, tap **More details → Install anyway**. This appears because the app is not from the Play Store.
6. Tap **Open**.

If an older test APK is installed, **uninstall** it first, then install the new one.

## Sign in

The first screen has a **Server address** field. It is already filled in with the server link:

```
https://listings-extensive-simultaneously-upc.trycloudflare.com
```

Leave it as it is. If the app says it can't reach the server, ask the app owner for the **new link** and paste it into this field.

**Create your own account (recommended):**

1. Enter your email and tap **Continue**.
2. Enter your name (letters only) and a password of at least 8 characters, then tap **Create account**.
3. No email code is needed. The account works right away.

A new account can **buy** on the P2P market straight away. To **sell**, the app team has to "Unlock" your account. Ask the app owner if you want to test selling.

**Demo accounts:** at the bottom of the sign-in screen there are buttons for demo accounts (Admin, Agent, Reseller). One tap signs you in. All testers share these accounts, so don't put your personal details in them.

## What to test

Tick each item once you've tried it. If something doesn't work, report it as described in "How to report a problem" below. Chat and orders are easiest to test with two phones (or two accounts).

**Sign in**

- [ ] Create a new account and sign in
- [ ] Sign out and sign in again

**Chat**

- [ ] Send a message to another tester and check their reply arrives
- [ ] Send a photo, a file and a voice message
- [ ] Check messages show the 🔒 (encrypted) mark

**Groups and communities**

- [ ] Create a group and add 2–3 testers
- [ ] Send a message in the group, remove a member, and leave the group
- [ ] Create a community and add a group to it

**P2P market**

- [ ] Browse ads on the market and check the photos show
- [ ] Place an order and tap "I have paid"
- [ ] (Seller) Check the phone rings when a new order arrives
- [ ] (Seller) Confirm the payment and release the order
- [ ] Buy an "Instant delivery" ad: after release, check the link or file appears under "Your product"

**To-dos and reminders**

- [ ] Create a to-do, tick it as done, and delete it
- [ ] Set a reminder and check it rings on time

**Look and feel**

- [ ] Screens look right in both light and dark theme
- [ ] Buttons stay visible when the keyboard opens

## Known limits of this build

These are missing or only work some of the time. There is no need to report them.

- **The server is not always on:** it runs on the app owner's computer. When that computer is off, the app can't connect. If the server link changes, the app owner will send you the new one.
- **No notifications when the app is closed:** message, order and reminder notifications arrive only while the app is open (or in the background).
- **No voice or video calls yet.**
- **Groups with more than 1,000 members** are not 🔒 end-to-end encrypted. This is on purpose.
- **Demo data is shared:** any change someone makes in a demo account is visible to everyone.

## How to report a problem

If something doesn't work, send the app owner these 5 things on WhatsApp:

1. **What you did:** which screen, which button you tapped
2. **What should have happened**
3. **What happened instead:** the exact words of any error message
4. **A screenshot** (or a screen recording)
5. **Your phone model** and Android version (Settings → About phone)

Example: "P2P → order screen, tapped 'I have paid'. The order should turn 'Paid', but it said 'Couldn't reach the server'. Screenshot attached. Redmi Note 12, Android 14."

## For the app owner: keeping the server and link running

While testers use the app, **two windows must stay open** on this computer. If either closes, the app can't connect.

1. Double-click `D:\bussiness-messaaging\backend\start-backend.bat` and wait until it says "API ready".
2. Double-click `D:\bussiness-messaaging\backend\start-public-link.bat`. It shows the **public link** and copies it.
3. If the link is **different** from the one in "Sign in" above, send testers the new link. They paste it into **Server address** on the sign-in screen.

Keep in mind:

- Closing the link window or restarting the computer creates a **new link**. The old one stops working.
- To stop the computer going to sleep, set Sleep to **Never** in Settings → Power.
- For a permanent link (without this computer), the server has to be put online on a hosting service.
