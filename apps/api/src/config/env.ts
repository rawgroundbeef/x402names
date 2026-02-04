import { cleanEnv, str, port, bool, num } from 'envalid';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ['development', 'test', 'production'],
    default: 'development',
  }),
  PORT: port({ default: 3000 }),
  REDIRECT_PORT: port({ default: 3001 }),
  REDIRECT_SERVER_IP: str({ default: '127.0.0.1' }),
  BEHIND_PROXY: bool({ default: false }),
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
  REGISTRAR_CONTACT_FIRST_NAME: str({ default: 'Domain' }),
  REGISTRAR_CONTACT_LAST_NAME: str({ default: 'Admin' }),
  REGISTRAR_CONTACT_ADDRESS: str({ default: '123 Service St' }),
  REGISTRAR_CONTACT_CITY: str({ default: 'San Francisco' }),
  REGISTRAR_CONTACT_STATE: str({ default: 'CA' }),
  REGISTRAR_CONTACT_POSTAL: str({ default: '94105' }),
  REGISTRAR_CONTACT_COUNTRY: str({ default: 'US' }),
  REGISTRAR_CONTACT_PHONE: str({ default: '+1.5555555555' }),
  REGISTRAR_CONTACT_EMAIL: str({ default: 'domains@x402.org' }),
});
