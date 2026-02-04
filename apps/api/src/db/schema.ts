import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const domains = sqliteTable('domains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  tld: text('tld').notNull(),
  status: text('status', {
    enum: ['pending', 'paid', 'registered', 'live', 'failed']
  }).notNull().default('pending'),
  ownerWallet: text('owner_wallet').notNull(),
  targetUrl: text('target_url'),
  paymentId: text('payment_id').unique(),
  registrarOrderId: text('registrar_order_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const system = sqliteTable('system', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
});

export const paymentRecords = sqliteTable('payment_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paymentId: text('payment_id').notNull().unique(),
  walletAddress: text('wallet_address').notNull(),
  amount: text('amount').notNull(),
  network: text('network').notNull(),
  domain: text('domain'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const registrationJobs = sqliteTable('registration_jobs', {
  id: text('id').primaryKey(),
  domainName: text('domain_name').notNull(),
  tld: text('tld').notNull(),
  ownerWallet: text('owner_wallet').notNull(),
  paymentId: text('payment_id').notNull().unique(),
  amountPaid: text('amount_paid').notNull(),
  targetUrl: text('target_url'),
  state: text('state', { enum: ['processing', 'succeeded', 'failed'] }).notNull().default('processing'),
  progress: integer('progress').default(0),
  currentStep: text('current_step'),
  error: text('error'),
  errorCode: text('error_code'),
  registrarOrderId: text('registrar_order_id'),
  attempts: integer('attempts').default(0),
  nextRetryAt: integer('next_retry_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});
