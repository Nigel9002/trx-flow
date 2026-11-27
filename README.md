# TRX FLOW

TRX FLOW is a React + Vite internal operations platform using Firebase Authentication and Cloud Firestore. The supported setup targets Firebase's no-billing Spark plan; file uploads and server-side automation are not included.

## Run locally

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env` and provide the Firebase web-app configuration. There is no demo or public registration mode; sign-in requires an existing Firebase Authentication user and an active `users/{uid}` profile.

## Firebase Spark setup

1. Use the configured Firebase project `trx-20`, or update `.firebaserc` to your own project.
2. In Firebase Console, enable Email/Password under **Authentication → Sign-in method**, create a **Firestore Database**, and add the local and production domains under **Authentication → Settings → Authorized domains**.
3. Configure the web app values in `.env`.
4. Create an administrator in **Authentication → Users → Add user**. Copy the new user's UID, then create a Firestore document at `users/{uid}` with these fields:

   ```json
   {
     "name": "Administrator name",
     "email": "admin@example.com",
     "role": "admin",
     "status": "active"
   }
   ```

   Set the initial password when creating the Auth user and use Firebase's password-reset flow if needed. Create employee users the same way, using `"role": "employee"`.
5. Deploy Firestore rules, build the frontend, then deploy Hosting:

   ```powershell
   npx firebase-tools deploy --only firestore:rules
   npm run build
   npx firebase-tools deploy --only hosting
   ```

These steps use Firebase Authentication, Firestore, and Hosting only. Do not deploy Cloud Functions or Firebase Storage; those features are not part of this Spark setup. Stay within the current Firebase Spark quotas.

## Publish on GitHub Pages

The repository includes a GitHub Actions workflow at `.github/workflows/deploy.yml`. To publish:

1. Push this project to a GitHub repository. GitHub Pages on the Free plan generally requires a public repository, so the source code will be visible. `.env` is ignored by Git; do not force-add it or commit passwords, service-account keys, or other credentials.
2. In the repository, open **Settings → Secrets and variables → Actions** and add these repository secrets using the matching values from your local `.env`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_MEASUREMENT_ID`.
3. Open **Settings → Pages**, choose **GitHub Actions** as the build and deployment source, then push to `main` or manually run the **Deploy TRX FLOW to GitHub Pages** workflow from the Actions tab.
4. Add `<your-github-username>.github.io` to **Firebase Console → Authentication → Settings → Authorized domains**.

The deployment uses the repository name for the Pages base path and adapts the app's static assets and service worker to that path. The Firebase web configuration is included in client-side JavaScript when the site is built; it is not a password. Secure access with Firestore rules and Firebase Authentication, and never put admin passwords or service-account credentials in Actions secrets.

## Available features

- Firebase sign-in, session restoration, password-reset email, and sign-out.
- Admin-managed accounts and employees (employee password reset emails use Firebase Authentication).
- Live Firestore account, payment, task, employee, conversation, amendment, and settings views.
- Account, payment, and task creation; payment review and employee task status updates.
- Internal conversations, amendments, administrator CSV exports, and printable reports that can be saved as PDF.
- Installable PWA shell with cached static assets and an offline page shell; Firebase data is not cached by the service worker.

File uploads, document management, task attachments, automated notifications/reminders, and Cloud Functions-based employee provisioning are unavailable without paid-only Firebase services.

The UI intentionally does not process or verify money transfers. Payment records are bookkeeping submissions only.

## Security notes

- Passwords are handled only by Firebase Authentication and are never written to Firestore.
- Employees cannot create users, change roles, review payments, or read other employees' records.
- Client-side config files contain Firebase web-app identifiers only; never place service-account credentials or admin passwords in the frontend or `.env`.
- Admin permissions are checked in Firestore rules.
- Approved payment records are immutable through ordinary Firestore updates; corrections should be made through the amendments workflow.
