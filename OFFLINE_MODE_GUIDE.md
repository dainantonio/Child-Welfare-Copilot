# Offline Mode & PWA Implementation Guide

## Overview

The Child Welfare Copilot now includes comprehensive offline functionality through Progressive Web App (PWA) technology, enabling caseworkers to work in rural areas with zero cell service.

## Features

### 1. Full Offline Mode (PWA)

The application now operates as a Progressive Web App with the following capabilities:

- **Service Worker Registration**: Automatic service worker installation for offline support
- **Asset Caching**: All CSS, JavaScript, and HTML assets are cached for offline access
- **Offline Persistence**: The app remains fully functional without internet connectivity
- **Automatic Updates**: When online, the app checks for updates and prompts users to refresh

#### How It Works

1. On first visit, the browser downloads and caches all necessary assets
2. The service worker intercepts network requests
3. When offline, cached assets are served directly
4. When online, the app syncs any pending data

### 2. Local Note Saving & AI Queue

Caseworkers can continue working offline with full note-taking capabilities:

#### Offline Queue Service (`src/services/offlineQueueService.ts`)

- **Local Storage**: Notes are saved to browser's local storage with unique IDs
- **Timestamp Tracking**: Each offline note is timestamped for chronological ordering
- **Queue Management**: Notes are organized in a processing queue
- **Automatic Sync**: When the device reconnects to Wi-Fi, notes are automatically queued for AI generation

#### Usage Flow

1. **While Offline**:
   - Caseworker fills out case details and clicks "Generate Professional Report"
   - System detects offline status and saves notes locally
   - User receives confirmation that notes are saved and queued
   - Notes persist in browser storage even if app is closed

2. **When Reconnecting to Wi-Fi**:
   - App detects online status automatically
   - Offline queue processes automatically
   - Notes are sent to Firestore for AI generation
   - User sees "Syncing..." status in header
   - Generated reports appear once processing completes

#### Implementation Details

```typescript
// Adding notes to offline queue
offlineQueueService.addToQueue({
  reportTitle: caseData.reportTitle,
  caseNotes: caseData.caseNotes,
  caseType: caseData.caseType,
  childInfo: caseData.childInfo,
  state: caseData.state
});

// Processing queue when online
await offlineQueueService.processQueue(userId);
```

### 3. Multilingual Support

The app now supports instant translation of generated reports for cases involving non-English speaking families.

#### Supported Languages

- English (en)
- Spanish (es)
- French (fr)
- Chinese (zh)
- Vietnamese (vi)
- Arabic (ar)
- Tagalog (tl)

#### Translation Service (`src/services/translationService.ts`)

- **AI-Powered Translation**: Uses Gemini API for accurate, context-aware translation
- **Professional Tone Preservation**: Maintains clinical and professional language suitable for child welfare documentation
- **Real-Time Translation**: Instant translation of generated reports
- **Fallback Support**: If translation fails, original text is preserved

#### Usage

1. Generate a report as normal
2. In the report header, select desired language from dropdown
3. Translation processes in real-time
4. Translated report displays immediately
5. Download or copy translated version as needed

#### Implementation

```typescript
// Translate report to Spanish
const translated = await translateText(report, 'es');

// Translation maintains professional tone through system prompt
const prompt = `Translate to ${language}. Maintain professional clinical tone suitable for child welfare casework.`;
```

## Technical Architecture

### PWA Configuration

**File**: `vite.config.ts`

```typescript
VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'Child Welfare Copilot',
    short_name: 'CW Copilot',
    description: 'AI-powered assistant for child welfare caseworkers',
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
    ]
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
    runtimeCaching: [
      // Google Fonts cached for 365 days
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-cache',
          expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 }
        }
      }
    ]
  }
})
```

### Service Worker Registration

**File**: `src/main.tsx`

```typescript
import { registerSW } from 'virtual:pwa-register';

registerSW({
  onNeedRefresh() {
    if (confirm('New content available. Reload?')) {
      window.location.reload();
    }
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  },
});
```

### State Management

**Online/Offline Detection** in `src/App.tsx`:

```typescript
const [isOnline, setIsOnline] = useState(navigator.onLine);
const [syncing, setSyncing] = useState(false);

// Listen for online/offline events
useEffect(() => {
  const handleOnline = () => {
    setIsOnline(true);
    if (user) syncOfflineQueue();
  };
  const handleOffline = () => setIsOnline(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
}, [user]);
```

## User Interface Enhancements

### Online Status Indicator

Located in the header, displays:
- **Online**: Green indicator with "Online" text
- **Offline**: Amber indicator with "Offline Mode" text (pulsing animation)
- **Syncing**: "Syncing..." text while processing offline queue

### Translation Dropdown

Located in the report header, allows:
- Selection of target language
- Real-time translation of report
- Disabled when offline (translation requires API access)
- Loading indicator during translation

### Offline Queue Notifications

When offline:
- Error message indicates offline status
- Notes are automatically saved locally
- User receives confirmation of local save
- Queue status visible in header

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    OFFLINE WORKFLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Caseworker in rural area (no cell service)             │
│     ↓                                                        │
│  2. App detects offline status (navigator.onLine = false)  │
│     ↓                                                        │
│  3. User fills out case details and clicks Generate        │
│     ↓                                                        │
│  4. System saves to localStorage via offlineQueueService   │
│     ↓                                                        │
│  5. User receives confirmation: "Saved locally"            │
│     ↓                                                        │
│  6. Caseworker returns to area with Wi-Fi                  │
│     ↓                                                        │
│  7. App detects online status (navigator.onLine = true)    │
│     ↓                                                        │
│  8. syncOfflineQueue() triggered automatically             │
│     ↓                                                        │
│  9. Queue items sent to Firestore for AI generation        │
│     ↓                                                        │
│  10. Reports generated and returned to app                 │
│     ↓                                                        │
│  11. User sees completed reports in report section         │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  TRANSLATION WORKFLOW                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Report generated (online only)                         │
│     ↓                                                        │
│  2. User selects language from dropdown (e.g., Spanish)    │
│     ↓                                                        │
│  3. handleTranslate() called with language code            │
│     ↓                                                        │
│  4. translateText() sends report to Gemini API             │
│     ↓                                                        │
│  5. API returns translated text with professional tone     │
│     ↓                                                        │
│  6. Report display updated with translation               │
│     ↓                                                        │
│  7. User can download/copy translated version             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Installation & Deployment

### For Development

```bash
cd Child-Welfare-Copilot
pnpm install
pnpm dev
```

The PWA will be available with offline support in development mode.

### For Production

```bash
pnpm build
```

The build process:
1. Creates optimized bundles
2. Generates service worker
3. Creates PWA manifest
4. Outputs to `dist/` directory

Deploy the `dist/` folder to your hosting provider. The PWA will be installable on:
- Chrome/Edge (Windows, Mac, Linux, Android)
- Safari (iOS 16.4+, macOS 13.3+)
- Firefox (Desktop)

### Installation Methods

**Web App**:
1. Visit the deployed URL
2. Click browser's "Install" button (or menu → "Install app")
3. App appears on home screen/app drawer

**Desktop**:
1. Same as web app
2. Creates desktop shortcut
3. Runs in standalone window

## Testing Offline Functionality

### Chrome DevTools

1. Open DevTools (F12)
2. Go to Application → Service Workers
3. Check "Offline" checkbox
4. Refresh page
5. App should continue working

### Network Throttling

1. DevTools → Network tab
2. Change throttle to "Offline"
3. Verify offline queue functionality

### Real Testing

1. Deploy to staging environment
2. Test on actual mobile device
3. Disconnect from Wi-Fi
4. Verify offline functionality
5. Reconnect and verify sync

## Troubleshooting

### Service Worker Not Installing

- Clear browser cache (DevTools → Application → Clear storage)
- Ensure HTTPS is enabled (required for service workers)
- Check browser console for errors

### Offline Queue Not Syncing

- Verify Firebase credentials are valid
- Check user is authenticated
- Ensure internet connection is stable
- Check browser console for sync errors

### Translation Not Working

- Verify `GEMINI_API_KEY` environment variable is set
- Ensure user is online (translation requires API)
- Check API quota limits
- Review Gemini API error messages in console

## Security Considerations

- All offline data is stored in browser's localStorage
- Data is not encrypted (use HTTPS for transmission)
- Service worker caches only public assets
- Sensitive data (PII) is redacted before offline storage
- Consider implementing IndexedDB for larger data volumes

## Future Enhancements

- Encrypted offline storage for sensitive data
- Offline image/audio attachment support
- Batch processing for multiple offline notes
- Sync conflict resolution
- Offline analytics and reporting
- Background sync API for automatic syncing

## Support & Documentation

For issues or questions:
1. Check browser console for error messages
2. Review offline queue status in header
3. Verify internet connectivity
4. Check Firebase/Gemini API status
5. Contact development team with error details
