const path = require('path')
const fs = require('fs')
const os = require('os')
const withNextIntl = require('next-intl/plugin')('./src/i18n/request-config.ts')

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
const TRAILING_SLASH_API_ROUTES = [
  'assets',
  'playlists',
  'destinations',
  'streams',
  'media-folders',
  'media-collections',
  'metrics',
]

// CSP mode: 'report-only' (default during rollout), 'enforce', or 'disabled'.
// Flip to 'enforce' after a 48h window with zero violations in Sentry.
const CSP_MODE = (process.env.CSP_MODE || 'report-only').toLowerCase()

const CSP_REPORT_URI = process.env.CSP_REPORT_URI || ''

const SUPABASE_HTTPS = 'https://*.supabase.co'
const SUPABASE_WSS = 'wss://*.supabase.co'

const buildCsp = () => {
  const directives = {
    // Default-deny posture; specific directives below grant the minimum needed.
    'default-src': ["'self'"],
    // Next.js App Router emits inline hydration scripts; until a nonce/hash
    // pipeline is wired, allow 'unsafe-inline' for scripts. 'unsafe-eval' is
    // intentionally NOT allowed.
    'script-src': ["'self'", "'unsafe-inline'"],
    // Tailwind + Next.js inline styles require unsafe-inline. We still block
    // remote stylesheets except from self.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    // Allow API/WebSocket to backend (same-origin) plus Supabase.
    'connect-src': ["'self'", SUPABASE_HTTPS, SUPABASE_WSS, 'wss:'],
    'media-src': ["'self'", 'blob:'],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  }

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`)
  parts.push('upgrade-insecure-requests')
  if (CSP_REPORT_URI) {
    parts.push(`report-uri ${CSP_REPORT_URI}`)
  }
  return parts.join('; ')
}

const buildSecurityHeaders = () => {
  const baseHeaders = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    },
  ]

  if (CSP_MODE === 'disabled') {
    return baseHeaders
  }

  const cspHeaderName =
    CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'

  return [...baseHeaders, { key: cspHeaderName, value: buildCsp() }]
}

const nextConfig = {
  transpilePackages: ['@supabase/supabase-js'],
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  allowedDevOrigins: allowedOrigins,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
      allowedOrigins,
    },
  },
  async headers() {
    return [
      {
        // Apply security headers to every page response. API/static assets
        // proxied by `rewrites()` are served by the backend, which sets its
        // own headers via `SecurityHeadersMiddleware`.
        source: '/:path*',
        headers: buildSecurityHeaders(),
      },
    ]
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
      ...TRAILING_SLASH_API_ROUTES.flatMap((route) => ([
        {
          source: `/api/${route}`,
          destination: `${DEV_API_PROXY_TARGET}/api/${route}/`,
        },
        {
          source: `/api/${route}/`,
          destination: `${DEV_API_PROXY_TARGET}/api/${route}/`,
        },
      ])),
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
