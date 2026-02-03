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
