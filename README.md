# AFE Student Learning App

A production-grade, **installer-first** Electron desktop application for Windows with strict backend/frontend separation, silent installation capability, and an offline-first architecture.

## 🎯 Overview

This is a **multi-student, offline-capable learning application** designed for deployment on shared laptops in environments with limited internet connectivity.

All data persists in:

```text
C:\ProgramData\OfflineLearningApp\
```

This ensures data survives:

* App upgrades
* User account changes
* Reinstalls

## 🏗️ Architecture

### Monorepo Structure

```text
/apps
  /desktop          → Electron main process (backend runtime)
  /renderer        → React UI (frontend only)

/packages
  /backend         → Backend-only packages (NOT accessible to renderer)
    /db            → SQLite with Drizzle ORM
    /content-engine → JSON manifest loader + validators
    /analytics     → Local analytics aggregation
    /ai-tutor      → Ollama integration (optional)
    /stt-engine    → Offline Whisper-based Speech-to-Text
    /tts-engine    → Offline Piper-based Text-to-Speech

  /shared          → Shared types, constants, IPC contracts
```

### Security & Separation

* ✅ **Renderer has NO Node.js access** (`nodeIntegration: false`, `contextIsolation: true`)
* ✅ **Backend packages cannot be imported by renderer** (enforced via ESLint)
* ✅ **Communication via secure IPC only** (whitelisted channels in preload)

## 📦 Installation

### Prerequisites

* **Node.js**: v20 LTS only (`>=20 <21`)
* **pnpm**: v9 or higher (recommended)
* **Git**: Latest version
* **Ollama**: Optional, required for AI features
* **Windows**: Windows 10/11 (target platform)
* **C++ Build Tools**: Visual Studio Build Tools with Desktop development with C++, required for some native dependencies if prebuilds are missing

> **Note:** Node 24 is not currently supported because the native SQLite dependency `better-sqlite3` fails to build on that runtime.

### Setup

```powershell
# Clone repository
git clone <repository-url>

cd AFE

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## 🚀 Development

### Running in Development Mode

```powershell
# Start both desktop and renderer in watch mode
pnpm dev
```

This will:

1. Start the Vite development server for the renderer (port 5173)
2. Compile and run the Electron main process
3. Open the app with DevTools enabled

### Building for Production

```powershell
# Build all packages
pnpm build

# Create Windows installer
pnpm build:installer
```

This produces:

```text
OfflineLearningApp-Setup-<version>.exe
```

in:

```text
apps/desktop/release/
```

## 📥 Silent Installation

The installer supports **fully silent installation** for enterprise deployment:

```powershell
# Silent install (no UI, no prompts)
OfflineLearningApp-Setup.exe /S
```

### Installation Paths

* **Application**: `C:\Program Files\Offline Learning App\`
* **Data**: `C:\ProgramData\OfflineLearningApp\`

  * Database: `data.db`
  * Content: `content\manifest.json`
  * Assets: `assets\videos\`, `assets\avatars\`

## 📚 Content Management

Content is stored as JSON manifests with strict schema validation.

### Content Manifest Location

```text
C:\ProgramData\OfflineLearningApp\content\manifest.json
```

### Schema Requirements

Every content item MUST include:

* `contentId` (UUID)
* `version` (semver)
* `hash` (for integrity verification)

See `installer-assets/content/manifest.json` for a sample.

## 🗄️ Database

* **Engine**: SQLite (file-based)
* **ORM**: Drizzle
* **Location**: `C:\ProgramData\OfflineLearningApp\data.db`

### Tables

* `students` - Multi-student support
* `modules`, `lessons` - Cached content
* `video_progress` - Watch tracking
* `quiz_attempts` - Quiz performance
* `analytics_events` - Event tracking (append-only)
* `ai_chat_history` - AI tutor conversations
* `sync_queue` - Future online sync

## 🎨 UI Design

**Neo-Brutalism** aesthetic:

* Bold, chunky borders
* High-contrast vibrant colors
* Strong shadows
* Playful, energetic feel

## 🤖 AI Tutor (Optional)

The app integrates with **Ollama** for offline AI tutoring.

### 🎙️ Voice Mode (Offline)

The AI Tutor supports a full **voice-to-voice** interaction mode:

* **Speech-to-Text (STT)**: Powered by **Whisper** (`whisper.cpp`) for high-accuracy offline transcription
* **Text-to-Speech (TTS)**: Powered by **Piper**, providing high-quality offline voices
* **VAD**: Built-in Voice Activity Detection for seamless hands-free interaction

### Setup Ollama

```powershell
# Install Ollama (optional)
# Download from: https://ollama.ai

# Pull a model
ollama pull llama2
```

If Ollama is not running, the AI tutor gracefully falls back with a friendly message.

## 📊 Analytics

All analytics are **local-only** with no external reporting:

* Time spent per module
* Video watch duration
* Quiz performance and improvement
* Append-only event system

## 🔒 Security & Compliance

### Installer-Level Security

* ✅ No runtime installation logic
* ✅ No privilege elevation at runtime
* ✅ No auto-update (installer-only updates)
* ✅ Deterministic builds
* ✅ No code download at runtime

### Runtime Security

* ✅ Renderer process fully sandboxed
* ✅ IPC channels whitelisted
* ✅ No remote code execution
* ✅ Foreign keys enforced in SQLite

## 🚫 Explicit Non-Goals

This app will **NOT**:

* Manage its own installation
* Elevate privileges at runtime
* Assume internet access during installation
* Handle device management (external concern)

## 🛠️ Development Commands

```powershell
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Type check all packages
pnpm typecheck

# Lint code
pnpm lint

# Build all packages
pnpm build

# Build Windows installer
pnpm build:installer
```

## 📁 Project Structure

```text
AFE/
├── apps/
│   ├── desktop/              # Electron main + preload
│   │   ├── src/
│   │   │   ├── main/         # Main process
│   │   │   ├── preload/      # IPC bridge
│   │   │   └── ipc/          # IPC handlers
│   │   └── electron-builder.config.js
│   └── renderer/             # React UI
│       └── src/
│           ├── pages/         # Page components
│           ├── styles/        # Neo-Brutalism CSS
│           └── lib/           # IPC client
├── packages/
│   ├── backend/
│   │   ├── db/               # Database layer
│   │   ├── content-engine/   # Content loading
│   │   ├── analytics/        # Analytics
│   │   ├── ai-tutor/         # AI integration
│   │   ├── stt-engine/       # Whisper STT engine
│   │   └── tts-engine/       # Piper TTS engine
│   └── shared/                # Shared types & IPC contracts
├── installer-assets/          # Files copied during install
│   ├── content/
│   │   └── manifest.json
│   └── assets/
└── pnpm-workspace.yaml
```

## 🧪 Testing

### Manual Testing Checklist

1. ✅ Install via silent installer (`/S`)
2. ✅ Create multiple students
3. ✅ Verify data persists in `C:\ProgramData\OfflineLearningApp\`
4. ✅ Browse modules
5. ✅ Check analytics dashboard
6. ✅ Upgrade to a new version and verify data survives
7. ✅ Uninstall and verify data persists

## 👥 Authors

NavGurukul Team

---

**Built with** ⚡ Electron | ⚛️ React | 🗃️ SQLite | 🎨 Neo-Brutalism
