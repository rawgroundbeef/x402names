import { cleanEnv, str, port, bool, num } from 'envalid';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ['development', 'test', 'production'],
    default: 'development',
  }),
  PORT: port({ default: 3000 }),
  DATABASE_URL: str({ default: './data/app.db' }),
  LOG_LEVEL: str({
    choices: ['debug', 'info', 'warn', 'error'],
    default: 'info',
  }),
  X402_RECEIVING_ADDRESS: str({ default: '' }),
  X402_FACILITATOR_URL: str({ default: 'https://x402.org/facilitator' }),
  X402_NETWORK: str({ default: 'eip155:84532' }),
  NAMECHEAP_API_USER: str({ default: '' }),
  NAMECHEAP_API_KEY: str({ default: '' }),
  NAMECHEAP_CLIENT_IP: str({ default: '127.0.0.1' }),
  NAMECHEAP_SANDBOX: bool({ default: true }),
  DOMAIN_MARKUP_PERCENT: num({ default: 20 }),
});
