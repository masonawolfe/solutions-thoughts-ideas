// Shared Sentry initialization for all Netlify Functions
import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.CONTEXT || 'production', // Netlify sets CONTEXT
    tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
  });
}

export { Sentry };

// Wrapper to capture errors in function handlers
export function withSentry(handler) {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (error) {
      if (DSN) {
        Sentry.captureException(error, {
          extra: {
            url: req.url,
            method: req.method,
          }
        });
        await Sentry.flush(2000);
      }
      throw error;
    }
  };
}
