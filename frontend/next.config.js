const path = require('path')
const fs = require('fs')
const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const DEV_API_PROXY_TARGET = process.env.DEV_API_PROXY_TARGET || 'http://localhost:8000'

const DEV_ORIGIN_ENV = process.env.NEXT_ALLOWED_DEV_ORIGINS || ''
const DEV_ORIGIN_TOKENS = DEV_ORIGIN_ENV.split(',').map((origin) => origin.trim()).filter(Boolean)
const DEFAULT_DEV_ORIGINS = ['localhost', '127.0.0.1']

const unique = (arr) => [...new Set(arr)]

const nextConfig = {
  transpilePackages: ['@supabase/supabase-js'],
  reactStrictMode: true,
  allowedDevOrigins: unique([...DEFAULT_DEV_ORIGINS, ...DEV_ORIGIN_TOKENS]),
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
      allowedOrigins: unique([...DEFAULT_DEV_ORIGINS, ...DEV_ORIGIN_TOKENS]),
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
