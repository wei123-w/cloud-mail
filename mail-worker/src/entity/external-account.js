import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const externalAccount = sqliteTable('external_account', {
	externalAccountId: integer('external_account_id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull(),
	userId: integer('user_id').notNull(),
	provider: text('provider').notNull().default('generic'),
	authType: text('auth_type').notNull().default('password'),
	email: text('email').notNull(),
	receiveHost: text('receive_host').notNull().default(''),
	receivePort: integer('receive_port').notNull().default(993),
	receiveSecurity: text('receive_security').notNull().default('tls'),
	sendHost: text('send_host').notNull().default(''),
	sendPort: integer('send_port').notNull().default(465),
	sendSecurity: text('send_security').notNull().default('tls'),
	username: text('username').notNull().default(''),
	credential: text('credential').notNull().default(''),
	status: integer('status').notNull().default(0),
	syncCursor: text('sync_cursor').notNull().default(''),
	syncStatus: integer('sync_status').notNull().default(0),
	lastSyncTime: text('last_sync_time'),
	lastError: text('last_error').notNull().default(''),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`),
	isDel: integer('is_del').notNull().default(0)
});

export default externalAccount;
