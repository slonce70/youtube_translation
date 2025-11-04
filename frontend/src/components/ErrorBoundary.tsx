'use client'

import React from 'react'
import { Button } from './ui/Button'
import { AlertCircle } from 'lucide-react'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-md w-full space-y-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-error-100 dark:bg-error-900/20 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-error-600 dark:text-error-400" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                Что-то пошло не так
              </h2>
              <p className="text-slate-600 dark:text-slate-400">
                {this.state.error?.message || 'Неизвестная ошибка'}
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-4 p-4 bg-slate-900 rounded-lg text-left">
                <p className="text-xs font-mono text-slate-200 break-all">
                  {this.state.error.stack}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <Button
                onClick={this.handleReset}
                variant="primary"
                className="w-full"
              >
                Перезагрузить страницу
              </Button>
              
              <Button
                onClick={() => window.location.href = '/dashboard'}
                variant="secondary"
                className="w-full"
              >
                Вернуться на главную
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
