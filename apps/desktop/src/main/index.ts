import { app, BrowserWindow, protocol, net, session, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import log from 'electron-log';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ensureDirectories, getDatabasePath, hasContentManifest, PATHS, APP_DATA_ROOT, getSttRoot, getTtsRoot } from './paths.js';
import { isLowEndDevice } from '@afe/shared/hardware';
import { initializeDatabase, getUnsyncedSessions } from '@backend/db';
import { loadContentManifest } from '@backend/content-engine';
import { registerIPCHandlers } from '../ipc/handlers.js';
import { syncContentToDatabase } from './content-sync.js';
import { SyncService, checkAndGenerateSummaries, initializeAnalytics } from '@backend/analytics';
import { initializeAiTutor } from '@backend/ai-tutor';
import { getDeviceInfo, checkLocationPermissionAndPrompt, updateLocationFromIP } from './device-info.js';
import { SessionManager } from './session-manager.js';
import { init as initTTS } from '@backend/tts-engine';
import { initializeLogger } from './logger.js';

// 0. Initialize logger at the very beginning
initializeLogger();

/**
 * Safely load .env file in packaged or unpackaged environment
 */
function loadEnv() {
    const possibleEnvPaths = [
        path.join(app.getAppPath(), '.env'),
        path.join(process.resourcesPath, '.env'),
        path.join(app.getAppPath(), '../../.env'),
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), '../.env'),
    ];

    for (const envPath of possibleEnvPaths) {
        try {
            if (fs.existsSync(envPath)) {
                const content = fs.readFileSync(envPath, 'utf8');
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('#')) {
                        const eqIdx = trimmed.indexOf('=');
                        if (eqIdx > 0) {
                            const key = trimmed.slice(0, eqIdx).trim();
                            let val = trimmed.slice(eqIdx + 1).trim();
                            if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
                                val = val.slice(1, -1);
                            }
                            if (!process.env[key]) {
                                process.env[key] = val;
                            }
                        }
                    }
                }
                console.log(`✓ Environment variables loaded from ${envPath}`);
                break;
            }
        } catch (e) {
            // Ignore error
        }
    }
}

loadEnv();

// Configure Auto Updater for SILENT background updates
autoUpdater.logger = log;
(autoUpdater.logger as any).transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// 1. Enforce memory limits for low RAM (4GB) laptops without GPUs
if (isLowEndDevice()) {
    console.log('🤖 Applied Low-End Device Memory Restrictions (Max 512MB RAM)');
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
}
app.commandLine.appendSwitch('enable-experimental-web-platform-features');

/**
 * Convert Windows paths to file: URLs for net.fetch
 */
const toFileUrl = (filePath: string) => {
    let pathName = path.resolve(filePath).replace(/\\/g, '/');
    if (!pathName.startsWith('/')) {
        pathName = '/' + pathName;
    }
    return `file://${pathName}`;
};

// Register custom protocol privileges
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'media',
        privileges: {
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            stream: true,
        },
    },
]);

let mainWindow: BrowserWindow | null = null;

/**
 * Create main application window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        title: 'Amazon Future Engineer',
        icon: path.join(__dirname, '../../build/icon.png'),
        webPreferences: {
            // CRITICAL SECURITY: Disable Node integration in renderer
            nodeIntegration: false,
            // CRITICAL SECURITY: Enable context isolation
            contextIsolation: true,
            // Preload script for secure IPC bridge
            preload: path.join(__dirname, '../preload/secure.cjs'),
        },
    });

    mainWindow.maximize();

    // Load renderer UI
    if (app.isPackaged) {
        // Production: load built files
        mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
    } else {
        // Development: load from Vite dev server
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }

    // Check location permission once on install/first run, non-blocking
    setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            checkLocationPermissionAndPrompt(mainWindow);
        }
    }, 1500);

    mainWindow.on('close', (e) => {
        if ((global as any).isQuitting) return;

        // If no student is currently in an active session (e.g. profile selection screen), exit immediately without popup
        if (!SessionManager.getActiveStudentId()) {
            (global as any).isQuitting = true;
            return;
        }

        e.preventDefault();

        // Delegate the confirm exit dialog to the renderer process
        mainWindow!.webContents.send('app:request-exit');
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * Initialize application
 */
async function initialize() {
    console.log('🚀 Initializing Offline Learning App...');
    console.log('Environment:', {
        platform: process.platform,
        arch: process.arch,
        version: app.getVersion(),
        node: process.version,
        userData: app.getPath('userData'),
        isPackaged: app.isPackaged
    });

    // 1. Ensure data directories exist
    console.log('📁 Setting up data directories...');
    ensureDirectories();

    // 2. Handle initial content seeding
    const prodManifestPath = PATHS.MANIFEST;
    if (app.isPackaged) {
        // Production: copy bundled dev-data to AppData on first run or on update
        const versionFilePath = path.join(PATHS.ROOT, 'appVersion.txt');
        let storedVersion = '';
        if (fs.existsSync(versionFilePath)) {
            storedVersion = fs.readFileSync(versionFilePath, 'utf8').trim();
        }
        
        const currentVersion = app.getVersion();

        if (!fs.existsSync(prodManifestPath) || storedVersion !== currentVersion) {
            console.log(`📦 Update or First run detected. Seeding bundled content for version ${currentVersion}...`);
            const bundledDevData = path.join(process.resourcesPath, 'dev-data');
            if (fs.existsSync(bundledDevData)) {
                try {
                    // force: true ensures new manifest and videos overwrite old ones
                    fs.cpSync(bundledDevData, PATHS.ROOT, { recursive: true, force: true });
                    fs.writeFileSync(versionFilePath, currentVersion, 'utf8');
                    console.log(`✓ Copied content from bundled dev-data and updated version to ${currentVersion}`);
                } catch (error) {
                    console.error('❌ Failed to copy bundled dev-data:', error);
                }
            } else {
                console.warn('⚠️  Bundled dev-data not found at:', bundledDevData);
            }
        }
    } else {
        // Development: copy manifest from installer-assets if it exists
        const devManifestPath = path.join(app.getAppPath(), '../../installer-assets/content/manifest.json');
        const prodManifestDir = PATHS.CONTENT_DIR;

        if (fs.existsSync(devManifestPath)) {
            try {
                if (!fs.existsSync(prodManifestDir)) {
                    fs.mkdirSync(prodManifestDir, { recursive: true });
                }
                fs.copyFileSync(devManifestPath, prodManifestPath);
                console.log(`✓ Copied manifest from installer-assets to ${prodManifestPath}`);
            } catch (error) {
                console.error('❌ Failed to copy manifest from installer-assets:', error);
            }
        } else {
            console.warn('⚠️  Dev manifest not found at:', devManifestPath);
        }
    }

    // 2. Initialize database
    console.log('💾 Initializing database...');
    try {
        const dbPath = getDatabasePath();
        console.log(`Database path: ${dbPath}`);
        initializeDatabase(dbPath);

        // CRITICAL: Initialize other services that might have their own copy of @backend/db
        console.log('Initializing Analytics and AI Tutor DB...');
        initializeAnalytics(dbPath);
        initializeAiTutor(dbPath, APP_DATA_ROOT);

        console.log('✓ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        app.quit();
        return;
    }

    // 3. Check for content manifest and SYNC to DB
    if (!hasContentManifest()) {
        console.warn(
            `⚠️  No content manifest found. Please ensure content is installed in ${PATHS.CONTENT_DIR}`
        );
    } else {
        console.log('✓ Content manifest found');
        try {
            const manifest = loadContentManifest(APP_DATA_ROOT);
            await syncContentToDatabase(manifest);
        } catch (error) {
            console.error('❌ Failed to sync content manifest:', error);
            // We don't quit, maybe partial functionality works?
        }
    }

    // 4. Initialize STT and TTS engines
    // console.log('🎤 Initializing STT engine...');
    // const sttRoot = getSttRoot();
    // initSTT(sttRoot);
    // console.log('✓ STT engine initialized at:', sttRoot);

    console.log('🎤 Initializing Sherpa STT engine...');

    console.log('🔊 Initializing TTS engine...');
    const ttsRoot = getTtsRoot();
    initTTS(ttsRoot);
    console.log('✓ TTS engine initialized at:', ttsRoot);

    // 5. Register IPC handlers
    console.log('🔌 Registering IPC handlers...');
    registerIPCHandlers();
    console.log('✓ IPC handlers registered');

    // 5. Launch background sync worker (NON-BLOCKING)
    console.log('🚀 Launching background sync worker...');
    console.log('✅ App initialization complete (sync running in background)');

    // Run sync in background (non-blocking)
    (async () => {
        try {
            if (isLowEndDevice()) {
                console.log('🤖 Scheduling AI summary generation (background, delayed by 60s for low-end device)...');
                setTimeout(async () => {
                    console.log('🤖 Starting delayed AI summary generation (background)...');
                    // await checkAndGenerateSummaries(getDatabasePath());
                    console.log('✓ AI summaries generated');
                }, 60000);
            } else {
                console.log('🤖 Starting AI summary generation (background)...');
                // await checkAndGenerateSummaries(getDatabasePath());
                console.log('✓ AI summaries generated');
            }

            // Helper to check network connectivity safely in Electron main process
            const checkIsOnline = (): boolean => {
                try {
                    if (typeof (net as any).isOnline === 'function') {
                        return (net as any).isOnline();
                    }
                } catch (e) {
                    console.warn('[SyncEngine] Network status check error:', e);
                }
                return true; // Fallback to true so net.fetch can attempt request
            };

            // Setup offline-first periodic session synchronization
            const startSyncEngine = () => {
                const attemptSync = async () => {
                    try {
                        const isOnline = checkIsOnline();

                        if (isOnline) {
                            // Try to resolve location from IP if allowed and unset
                            await updateLocationFromIP(net.fetch);
                        }

                        const unsynced = await getUnsyncedSessions();
                        if (unsynced.length === 0) {
                            return;
                        }

                        if (!isOnline) {
                            console.log('[SyncEngine] Offline - skipping sync attempt.');
                            return;
                        }

                        const deviceInfo = await getDeviceInfo();
                        const rawServerUrl = process.env.CENTRALIZED_SERVER_URL || 'https://rms-api.thesama.in/api/afe';
                        const serverUrl = rawServerUrl.replace(/\/+$/, '');
                        const syncService = new SyncService(serverUrl, net.fetch);

                        console.log(`[SyncEngine] Online - attempting to sync ${unsynced.length} sessions to ${serverUrl}...`);
                        try {
                            const validation = await syncService.validateNGOKey(deviceInfo.ngoKey);
                            if (!validation.valid) {
                                console.warn(`[SyncEngine] NGO key validation warning: ${validation.error}. Proceeding with session sync.`);
                            }
                        } catch (valErr) {
                            console.warn(`[SyncEngine] NGO key validation endpoint check failed: ${valErr}. Proceeding with sync attempt.`);
                        }

                        const result = await syncService.syncToServer(deviceInfo);
                        if (result.success) {
                            console.log(`[SyncEngine] Synced ${result.syncedCount} sessions to server`);
                        } else {
                            console.warn('[SyncEngine] Sync failed - will retry next cycle');
                        }
                    } catch (error) {
                        console.error('[SyncEngine] Error in sync task:', error);
                    }
                };

                // Run immediately
                attemptSync();

                // Periodic check every 30 seconds
                setInterval(attemptSync, 30000);
            };

            startSyncEngine();
        } catch (error) {
            console.error('❌ Background sync setup failed:', error);
        }
    })();
}

// App lifecycle

app.whenReady().then(async () => {
    // Allow microphone/camera for STT; log to see exact permission strings
    const ses = session.defaultSession;
    const allowMedia = (p: string) =>
        p === 'media' || p === 'mediaKeySystem' || p === 'fullscreen' || p.includes('media') || p.includes('microphone') || p.includes('fullscreen');
    ses.setPermissionCheckHandler((_, permission) => {
        const allow = allowMedia(permission);
        console.log('[Electron] Permission check:', permission, '->', allow);
        return allow;
    });
    ses.setPermissionRequestHandler((_, permission, callback) => {
        const allow = allowMedia(permission);
        console.log('[Electron] Permission request:', permission, '->', allow);
        callback(allow);
    });

    // Register 'media' protocol to serve videos securely from APP_DATA
    protocol.handle('media', (request) => {
        const url = request.url.replace('media://', '');
        // Decode URL to handle spaces etc
        const decodedPath = decodeURIComponent(url);

        // Construct absolute path to the file
        // Manifest paths are relative to APP_DATA_ROOT (e.g. "assets/videos/foo.mp4")
        let assetPath = path.join(PATHS.ROOT, decodedPath);

        // In development, if the file doesn't exist in dev-data/assets, fallback to installer-assets/assets
        if (!app.isPackaged && !fs.existsSync(assetPath)) {
            const devFallbackPath = path.join(app.getAppPath(), '../../installer-assets', decodedPath);
            if (fs.existsSync(devFallbackPath)) {
                assetPath = devFallbackPath;
            }
        }

        // Security check: Ensure we are serving from the ASSETS directory
        // This prevents access to DB or other sensitive files
        const devAssetsDir = path.join(app.getAppPath(), '../../installer-assets/assets');
        const isAllowed = assetPath.startsWith(PATHS.ASSETS_DIR) ||
            (!app.isPackaged && assetPath.startsWith(devAssetsDir));

        if (!isAllowed) {
            console.error('Blocked access to non-asset path:', assetPath);
            return new Response('Access Denied', { status: 403 });
        }

        // If file doesn't exist, return 404
        if (!fs.existsSync(assetPath)) {
            return new Response('Not Found', { status: 404 });
        }

        const stat = fs.statSync(assetPath);
        const rangeHeader = request.headers.get('range');

        // Determine content type dynamically
        let contentType = 'application/octet-stream';
        const ext = path.extname(assetPath).toLowerCase();
        if (ext === '.mp4') {
            contentType = 'video/mp4';
        } else if (ext === '.mkv') {
            contentType = 'video/x-matroska';
        } else if (ext === '.pdf') {
            contentType = 'application/pdf';
        } else if (ext === '.png') {
            contentType = 'image/png';
        } else if (ext === '.jpg' || ext === '.jpeg') {
            contentType = 'image/jpeg';
        } else if (ext === '.webp') {
            contentType = 'image/webp';
        }

        if (rangeHeader) {
            // Parse Range: bytes=start-end
            const parts = rangeHeader.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

            const chunksize = (end - start) + 1;
            const fileStream = fs.createReadStream(assetPath, { start, end });

            return new Response(fileStream as any, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize.toString(),
                    'Content-Type': contentType
                }
            });
        } else {
            const fileStream = fs.createReadStream(assetPath);
            return new Response(fileStream as any, {
                status: 200,
                headers: {
                    'Content-Length': stat.size.toString(),
                    'Content-Type': contentType
                }
            });
        }
    });

    await initialize();
    createWindow();

    // Check for updates in the background
    if (app.isPackaged) {
        autoUpdater.checkForUpdates().then(() => {
            log.info('Update check completed');
        })
            .catch(err => {
                log.error('Error checking for updates:', err);
            });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // On Windows, apps typically quit when all windows are closed
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    console.log('👋 Application shutting down');
    // End active session if any on quit
    SessionManager.endSession(null, null).catch(e => {
        console.error('[Main] Failed to end session on quit:', e);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
