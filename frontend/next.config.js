const path = require('path')
const fs = require('fs')
const withNextIntl = require('next-intl/plugin')('./i18n.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
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
