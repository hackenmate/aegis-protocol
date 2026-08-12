import { router, json } from '@appdeploy/sdk';
import { analyzeRoute } from './aegis';

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'POST /api/analyze': [analyzeRoute],
});
