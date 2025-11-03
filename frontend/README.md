# YouTube Multi-Channel Streaming - Frontend

Next.js 15 frontend application for managing 24/7 YouTube streaming.

## Features

- 🎨 Modern UI with Tailwind CSS
- ⚡ Server Components and Server Actions
- 🔐 Supabase Authentication
- 📊 Real-time dashboard with metrics
- 📤 Resumable file uploads with Uppy + tus
- 🎬 Drag-and-drop playlist editor
- 📡 Live stream monitoring with SSE

## Getting Started

### Install Dependencies

```bash
npm install
# or
pnpm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
```

### Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
src/
├── app/              # Next.js App Router pages
│   ├── layout.tsx    # Root layout
│   ├── page.tsx      # Dashboard
│   ├── login/        # Authentication
│   ├── assets/       # Video management
│   ├── playlists/    # Playlist editor
│   ├── destinations/ # YouTube channels
│   └── streams/      # Stream control
├── components/       # React components
│   ├── ui/           # Reusable UI components
│   ├── UploadDialog.tsx
│   ├── StreamCard.tsx
│   └── LogViewer.tsx
└── lib/              # Utilities
    ├── supabase.ts   # Supabase client
    ├── api.ts        # API client
    └── utils.ts      # Helper functions
```

## Technologies

- **Framework:** Next.js 15
- **React:** React 19 with Server Components
- **Styling:** Tailwind CSS
- **State Management:** TanStack Query
- **Auth:** Supabase
- **File Upload:** Uppy + tus
- **TypeScript:** Type-safe development

## Building for Production

```bash
npm run build
npm start
```

## Docker

```bash
docker build -t youtube-streaming-frontend .
docker run -p 3000:3000 youtube-streaming-frontend
```
