// Server Initialization - Start cron jobs when backend starts
import { initializeCronJobs } from './lib/cron/jobs';

// Initialize cron jobs
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true') {
  initializeCronJobs();
  console.log('[Server] Backend initialized with cron jobs');
} else {
  console.log('[Server] Backend initialized (cron jobs disabled in development)');
}

export {};

