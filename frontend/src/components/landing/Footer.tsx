'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Radio, Github, Twitter, Youtube } from 'lucide-react'

export function Footer() {
  const t = useTranslations('landing.footer')

  const productLinks = ['features', 'pricing', 'docs', 'api']
  const companyLinks = ['about', 'blog', 'contact', 'support']
  const legalLinks = ['terms', 'privacy', 'security', 'compliance']

  return (
    <footer className="bg-slate-950 border-t border-slate-800/50" style={{
      borderImage: 'linear-gradient(to right, rgba(168, 85, 247, 0.3), rgba(6, 182, 212, 0.3)) 1',
    }}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
          {/* Brand Column */}
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-glow">
                <Radio className="w-6 h-6 text-white" />
              </div>
              <span className="text-lg font-bold gradient-text">
                {t('brand.name')}
              </span>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              {t('brand.tagline')}
            </p>
            <div className="flex items-center space-x-3">
              <a
                href="https://youtube.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-gradient-to-br hover:from-primary-500 hover:to-accent-500 flex items-center justify-center transition-all"
              >
                <Youtube className="w-5 h-5 text-slate-400 hover:text-white" />
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-gradient-to-br hover:from-primary-500 hover:to-accent-500 flex items-center justify-center transition-all"
              >
                <Github className="w-5 h-5 text-slate-400 hover:text-white" />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-gradient-to-br hover:from-primary-500 hover:to-accent-500 flex items-center justify-center transition-all"
              >
                <Twitter className="w-5 h-5 text-slate-400 hover:text-white" />
              </a>
            </div>
          </div>

          {/* Product Column */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">
              {t('product.title')}
            </h3>
            <ul className="space-y-2">
              {productLinks.map((link) => (
                <li key={link}>
                  <Link
                    href={`#${link}`}
                    className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {t(`product.${link}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">
              {t('company.title')}
            </h3>
            <ul className="space-y-2">
              {companyLinks.map((link) => (
                <li key={link}>
                  <Link
                    href={`#${link}`}
                    className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {t(`company.${link}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Column */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">
              {t('legal.title')}
            </h3>
            <ul className="space-y-2">
              {legalLinks.map((link) => (
                <li key={link}>
                  <Link
                    href={`#${link}`}
                    className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {t(`legal.${link}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="pt-8 border-t border-slate-800">
          <p className="text-center text-xs text-slate-500">
            {t('copyright')}
          </p>
        </div>
      </div>
    </footer>
  )
}
