import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const externalMessage = sqliteTable('external_message', {
	externalMessageId: integer('external_message_id').primaryKey({ autoIncrement: true }),
	externalAccountId: integer('external_account_id').notNull(),
	remoteId: text('remote_id').notNull(),
	remoteThreadId: text('remote_thread_id').notNull().default(''),
	emailId: integer('email_id').notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`)
}, table => ({
	accountRemoteUnique: uniqueIndex('idx_external_message_account_remote')
		.on(table.externalAccountId, table.remoteId)
}));

export default externalMessage;
