/**
 * Centralized logging utility for frontend
 * Replaces console.* calls with structured logging
 * Integrates with Sentry in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: any
}

class Logger {
  private isDevelopment: boolean

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development'
  }

  /**
   * Log debug information (development only)
   */
  debug(message: string, context?: LogContext): void {
    if (this.isDevelopment) {
      console.debug(`[DEBUG] ${message}`, context || '')
    }
  }

  /**
   * Log general information
   */
  info(message: string, context?: LogContext): void {
    if (this.isDevelopment) {
      console.info(`[INFO] ${message}`, context || '')
    }
    
    // In production, send to analytics/monitoring
    this.sendToSentry('info', message, context)
  }

  /**
   * Log warnings
   */
  warn(message: string, context?: LogContext): void {
    if (this.isDevelopment) {
      console.warn(`[WARN] ${message}`, context || '')
    }
    
    this.sendToSentry('warning', message, context)
  }

  /**
   * Log errors
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (this.isDevelopment) {
      console.error(`[ERROR] ${message}`, error || '', context || '')
    }
    
    // Always send errors to Sentry in production
    this.sendToSentry('error', message, { ...context, error })
  }

  /**
   * Send log to Sentry if available
   */
  private sendToSentry(
    level: 'info' | 'warning' | 'error',
    message: string,
    context?: LogContext
  ): void {
    // Only send to Sentry in production
    if (this.isDevelopment) return

    try {
      // Check if Sentry is available
      if (typeof window !== 'undefined' && (window as any).Sentry) {
        const Sentry = (window as any).Sentry

        if (level === 'error' && context?.error instanceof Error) {
          Sentry.captureException(context.error, {
            level,
            tags: { component: context?.component },
            extra: { message, ...context },
          })
        } else {
          Sentry.captureMessage(message, {
            level,
            extra: context,
          })
        }
      }
    } catch (err) {
      // Fallback to console if Sentry fails
      console.error('Failed to send log to Sentry:', err)
    }
  }

  /**
   * Create a logger instance with component context
   */
  withContext(component: string): ComponentLogger {
    return new ComponentLogger(component, this)
  }
}

/**
 * Component-specific logger with automatic context
 */
class ComponentLogger {
  constructor(
    private component: string,
    private logger: Logger
  ) {}

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, { component: this.component, ...context })
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, { component: this.component, ...context })
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, { component: this.component, ...context })
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    this.logger.error(message, error, { component: this.component, ...context })
  }
}

// Export singleton instance
export const logger = new Logger()

// Export for creating component-specific loggers
export const createLogger = (component: string) => logger.withContext(component)

// Type exports
export type { LogLevel, LogContext, ComponentLogger }
