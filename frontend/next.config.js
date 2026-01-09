const path = require('path')
const fs = require('fs')
const os = require('os')
const withNextIntl = require('next-intl/plugin')('./i18n.ts')

/** @type {import('next').NextConfig} */
const DEV_API_PROXY_TARGET = process.env.DEV_API_PROXY_TARGET || 'http://localhost:8000'

const DEV_ORIGIN_ENV = process.env.NEXT_ALLOWED_DEV_ORIGINS || ''
const DEV_ORIGIN_TOKENS = DEV_ORIGIN_ENV.split(',').map((origin) => origin.trim()).filter(Boolean)
const DEFAULT_DEV_ORIGINS = ['localhost', '127.0.0.1']

const resolveLocalNetworkHosts = () => {
  try {
    const interfaces = os.networkInterfaces()
    return Object.values(interfaces)
      .flat()
      .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[next.config] Failed to resolve local network hosts:', error)
    return []
  }
}

const LOCAL_NETWORK_ORIGINS = resolveLocalNetworkHosts()

const unique = (arr) => [...new Set(arr)]

const allowedOrigins = unique([...DEFAULT_DEV_ORIGINS, ...DEV_ORIGIN_TOKENS, ...LOCAL_NETWORK_ORIGINS])

const resolveOrigin = (value) => {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch (error) {
    return null
  }
}

const buildContentSecurityPolicy = () => {
  const isDev = process.env.NODE_ENV !== 'production'
  const connectSrc = new Set(["'self'", 'https://api.supabase.co', 'wss:', 'ws:'])

  const apiOrigin = resolveOrigin(process.env.NEXT_PUBLIC_API_URL)
  const supabaseOrigin = resolveOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const tusdOrigin = resolveOrigin(process.env.NEXT_PUBLIC_TUSD_URL)

  ;[apiOrigin, supabaseOrigin, tusdOrigin].filter(Boolean).forEach((origin) => connectSrc.add(origin))

  if (isDev) {
    connectSrc.add('http:')
    connectSrc.add('https:')
  }

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSrc).join(' ')}`,
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]

  return directives.join('; ')
}

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '..'),
  allowedDevOrigins: allowedOrigins,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
      allowedOrigins,
    },
  },
  async redirects() {
    return [
      {
        source: '/dashboard/assets',
        destination: '/dashboard/library?tab=assets',
        permanent: true,
      },
      {
        source: '/dashboard/playlists',
        destination: '/dashboard/library?tab=playlists',
        permanent: true,
      },
      {
        source: '/dashboard/destinations',
        destination: '/dashboard/streaming',
        permanent: true,
      },
      {
        source: '/dashboard/streams',
        destination: '/dashboard/streaming',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    if (process.env.NODE_ENV !== 'development' && !process.env.ENABLE_API_PROXY) {
      return []
    }

    return [
      {
        source: '/api/:path*',
        destination: `${DEV_API_PROXY_TARGET}/api/:path*`,
      },
      {
        source: '/thumbnails/:path*',
        destination: `${DEV_API_PROXY_TARGET}/thumbnails/:path*`,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(), payment=()' },
        ],
      },
    ]
  },
  webpack: (config) => {
    const wasmSource = path.resolve(
      __dirname,
      'node_modules/mediainfo.js/dist/MediaInfoModule.wasm'
    )
    const wasmTargets = [
      path.resolve(__dirname, 'node_modules/mediainfo.js/dist/esm-bundle/MediaInfoModule.wasm'),
      path.resolve(__dirname, 'node_modules/mediainfo.js/dist/esm/MediaInfoModule.wasm'),
    ]

    for (const target of wasmTargets) {
      if (!fs.existsSync(target) && fs.existsSync(wasmSource)) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(wasmSource, target)
      }
    }

    config.experiments = {
      ...(config.experiments || {}),
      asyncWebAssembly: true,
    }

    config.module.rules.push({
      test: /\.wasm$/i,
      type: 'asset/resource',
    })

    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'mediainfo.js/dist/esm-bundle/MediaInfoModule.wasm': path.resolve(
        __dirname,
        'node_modules/mediainfo.js/dist/MediaInfoModule.wasm'
      ),
      'mediainfo.js/dist/MediaInfoModule.wasm': path.resolve(
        __dirname,
        'node_modules/mediainfo.js/dist/MediaInfoModule.wasm'
      ),
    }

    return config
  },
}

module.exports = withNextIntl(nextConfig)
