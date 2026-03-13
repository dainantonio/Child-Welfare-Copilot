# Setup, Testing, and Sharing Guide

This guide explains how to finish setting up the Child Welfare Copilot, test its new features, and share it with your team.

## 1. Finish Setting Up

### Environment Variables
Ensure you have the following environment variables set in your deployment environment (e.g., Vercel, Netlify, or Firebase Hosting):

*   `GEMINI_API_KEY`: Your Google Gemini API key. This is required for both report generation and the new translation feature.
*   `DISABLE_HMR`: Set to `true` if you encounter issues with Hot Module Replacement in certain development environments, but usually not needed for production.

### Firebase Configuration
The app is currently configured using the settings in `firebase-applet-config.json`. If you move to a different Firebase project:
1.  Go to your Firebase Console.
2.  Project Settings → General → Your apps.
3.  Copy the Web App configuration and update `firebase-applet-config.json`.

## 2. Testing the New Features

### Testing Offline Mode (PWA)
1.  **Open the App**: Visit your deployed URL in a browser (Chrome is recommended for the best PWA experience).
2.  **Install the App**: You should see an "Install" icon in the address bar or a prompt to "Add to Home Screen." Install it to test the full standalone experience.
3.  **Go Offline**: 
    *   On Desktop: Open DevTools (F12) → Network tab → Change "No throttling" to "Offline."
    *   On Mobile: Turn on Airplane Mode.
4.  **Create a Note**: Fill out the case details while offline and click "Generate Professional Report."
5.  **Verify Queue**: You will see a message saying you are offline and your notes are saved locally.
6.  **Go Online**: Turn off Airplane Mode or set Network back to "No throttling."
7.  **Verify Sync**: The status indicator in the header will change to "Syncing..." and then back to "Online." Your report will then be generated.

### Testing Multilingual Support
1.  **Generate a Report**: While online, generate a report as you normally would.
2.  **Select Language**: In the header of the generated report, click the "Translate" dropdown.
3.  **Translate**: Select a language like "Spanish" or "Vietnamese."
4.  **Verify**: The report should update instantly to the selected language while maintaining its professional structure.

## 3. Sharing the App

### Deployment Options
*   **Vercel/Netlify**: The easiest way to share is to connect your GitHub repository to Vercel or Netlify. They will automatically build and deploy the app every time you push to `main`.
*   **Firebase Hosting**: Since you're already using Firebase, you can use Firebase Hosting:
    ```bash
    npm install -g firebase-tools
    firebase login
    firebase init hosting
    firebase deploy
    ```

### Inviting Your Team
1.  **Share the URL**: Once deployed, send the URL to your caseworkers.
2.  **Authentication**: The app uses Google Login. By default, anyone with a Google account can log in, but you can restrict this in the Firebase Console under Authentication → Sign-in method.
3.  **Roles**: The app currently assigns the "admin" role to `dain.russell@gmail.com`. You can change other users' roles directly in your Firestore database under the `users` collection.

## 4. Mobile Setup
For caseworkers in the field:
1.  Open the app URL in Safari (iOS) or Chrome (Android).
2.  **iOS**: Tap the Share button → "Add to Home Screen."
3.  **Android**: Tap the three dots menu → "Install app" or "Add to Home screen."
4.  The app will now appear on their home screen and work fully offline!
