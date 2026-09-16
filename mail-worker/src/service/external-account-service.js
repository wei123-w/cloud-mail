import BizError from '../error/biz-error.js';
import { and, eq, sql } from 'drizzle-orm';
import orm from '../entity/orm.js';
import account from '../entity/account.js';
import email from '../entity/email.js';
import { att } from '../entity/att.js';
import externalAccount from '../entity/external-account.js';
import externalMessage from '../entity/external-message.js';
import credentialUtils from '../utils/credential-utils.js';
import fileUtils from '../utils/file-utils.js';
import verifyUtils from '../utils/verify-utils.js';
import r2Service from './r2-service.js';
import googleAdapter from './external-mail/google-adapter.js';
import microsoftAdapter from './external-mail/microsoft-adapter.js';
import genericAdapter, { validateEndpoint } from './external-mail/generic-adapter.js';

const adapters = { google: googleAdapter, microsoft: microsoftAdapter, generic: genericAdapter };
const externalSourceType = 1;
const normalStatus = 0;

function getAdapter(provider) {
	const adapter = adapters[provider];
	if (!adapter) throw new BizError('暂不支持该邮箱服务商');
	return adapter;
}

function sanitizeExternalAccount(row = {}) {
	return {
		externalAccountId: row.externalAccountId,
		accountId: row.accountId,
		userId: row.userId,
		provider: row.provider,
		authType: row.authType,
		email: row.email,
		receiveHost: row.receiveHost,
		receivePort: row.receivePort,
		receiveSecurity: row.receiveSecurity,
		sendHost: row.sendHost,
		sendPort: row.sendPort,
		sendSecurity: row.sendSecurity,
		status: row.status,
		syncStatus: row.syncStatus,
		lastSyncTime: row.lastSyncTime,
		lastError: row.lastError,
		createTime: row.createTime
	};
}

function normalizeGenericParams(params = {}) {
	const emailValue = String(params.email || '').trim();
	const username = String(params.username || emailValue).trim();
	const password = String(params.password || '');
	if (!emailValue || !username || !password) throw new BizError('邮箱、用户名和密码不能为空');
	if (!verifyUtils.isEmail(emailValue)) throw new BizError('非法邮箱');
	const receiveInput = params.receive || {
		host: params.receiveHost,
		port: params.receivePort,
		security: params.receiveSecurity
	};
	const sendInput = params.send || {
		host: params.sendHost,
		port: params.sendPort,
		security: params.sendSecurity
	};
	const receive = validateEndpoint({ ...receiveInput, security: receiveInput.security || 'tls' }, 'receive');
	const send = validateEndpoint({ ...sendInput, security: sendInput.security || 'tls' }, 'send');
	return { email: emailValue, username, password, receive, send };
}

function buildExternalMailRecord(message = {}, accountInfo = {}) {
	const to = Array.isArray(message.to) ? message.to : [];
	return {
		accountId: accountInfo.accountId,
		userId: accountInfo.userId,
		sendEmail: message.from?.address || '',
		name: message.from?.name || '',
		subject: message.subject || '',
		text: message.text || '',
		content: message.html || '',
		cc: JSON.stringify(message.cc || []),
		bcc: JSON.stringify(message.bcc || []),
		recipient: JSON.stringify(to),
		toEmail: to[0]?.address || accountInfo.email || '',
		toName: to[0]?.name || '',
		inReplyTo: message.inReplyTo || '',
		relation: message.relation || '',
		messageId: message.messageId || '',
		type: 0,
		status: 0,
		unread: 0,
		createTime: message.createTime || undefined,
		isDel: 0
	};
}

function normalizeSendAddresses(values = []) {
	return values.map(value => typeof value === 'string'
		? { address: value, name: '' }
		: { address: value.address, name: value.name || '' });
}

function buildExternalSendMessage(params = {}, accountInfo = {}) {
	const messageId = params.sendType === 'reply' ? (params.messageId || '') : '';
	return {
		from: { address: accountInfo.email || '', name: params.name || '' },
		to: normalizeSendAddresses(params.receiveEmail || []),
		cc: normalizeSendAddresses(params.cc || []),
		bcc: normalizeSendAddresses(params.bcc || []),
		subject: params.subject || '',
		text: params.text || '',
		html: params.html || '',
		attachments: params.attachments || [],
		inReplyTo: messageId,
		relation: messageId
	};
}

function getCredentialSecret(c) {
	const secret = c?.env?.EXTERNAL_CREDENTIAL_SECRET;
	if (!secret) throw new BizError('外部邮箱凭据密钥未配置');
	return secret;
}

async function decryptCredential(c, row) {
	if (!row.credential) throw new BizError('外部邮箱凭据为空');
	try {
		return JSON.parse(await credentialUtils.decrypt(row.credential, getCredentialSecret(c)));
	} catch {
		throw new BizError('外部邮箱凭据无效');
	}
}

async function encryptCredential(c, credential) {
	return credentialUtils.encrypt(JSON.stringify(credential), getCredentialSecret(c));
}

async function findDuplicate(c, userId, emailValue) {
	return orm(c).select().from(externalAccount).where(and(
		eq(externalAccount.userId, Number(userId)),
		sql`${externalAccount.email} COLLATE NOCASE = ${emailValue}`,
		eq(externalAccount.isDel, normalStatus)
	)).get();
}

const externalAccountService = {
	getAdapter,

	async getById(c, externalAccountId, userId) {
		const row = await orm(c).select().from(externalAccount).where(and(
			eq(externalAccount.externalAccountId, Number(externalAccountId)),
			eq(externalAccount.userId, Number(userId)),
			eq(externalAccount.isDel, normalStatus)
		)).get();
		if (!row) throw new BizError('外部邮箱账号不存在或无权限');
		return row;
	},

	async list(c, userId) {
		const rows = await orm(c).select().from(externalAccount).where(and(
			eq(externalAccount.userId, Number(userId)),
			eq(externalAccount.isDel, normalStatus)
		)).all();
		return rows.map(sanitizeExternalAccount);
	},

	async addGeneric(c, params, userId) {
		const normalized = normalizeGenericParams(params);
		if (await findDuplicate(c, userId, normalized.email)) throw new BizError('该邮箱已经绑定');
		await genericAdapter.testConnection({
			receive: normalized.receive,
			send: normalized.send,
			credential: { username: normalized.username, password: normalized.password }
		});
		const accountRow = await orm(c).insert(account).values({
			email: normalized.email,
			userId: Number(userId),
			name: normalized.email.split('@')[0],
			sourceType: externalSourceType
		}).returning().get();
		const row = await orm(c).insert(externalAccount).values({
			accountId: accountRow.accountId,
			userId: Number(userId),
			provider: 'generic',
			authType: 'password',
			email: normalized.email,
			receiveHost: normalized.receive.host,
			receivePort: normalized.receive.port,
			receiveSecurity: normalized.receive.security,
			sendHost: normalized.send.host,
			sendPort: normalized.send.port,
			sendSecurity: normalized.send.security,
			username: normalized.username,
			credential: await encryptCredential(c, { username: normalized.username, password: normalized.password })
		}).returning().get();
		return sanitizeExternalAccount(row);
	},

	startOAuth(c, provider, userId) {
		return getAdapter(provider).startAuthorization(c, userId);
	},

	startAuthorization(c, provider, userId) {
		return this.startOAuth(c, provider, userId);
	},

	async completeOAuth(c, params, userId) {
		const result = await getAdapter(params.provider).completeAuthorization(c, params.code, params.state, userId);
		if (await findDuplicate(c, userId, result.email)) throw new BizError('该邮箱已经绑定');
		const accountRow = await orm(c).insert(account).values({
			email: result.email,
			userId: Number(userId),
			name: result.name,
			sourceType: externalSourceType
		}).returning().get();
		const row = await orm(c).insert(externalAccount).values({
			accountId: accountRow.accountId,
			userId: Number(userId),
			provider: params.provider,
			authType: 'oauth2',
			email: result.email,
			username: result.email,
			credential: result.credential
		}).returning().get();
		return sanitizeExternalAccount(row);
	},

	completeAuthorization(c, provider, code, state, userId) {
		return getAdapter(provider).completeAuthorization(c, code, state, userId);
	},

	async test(c, params, userId) {
		if (params.externalAccountId) {
			const row = await this.getById(c, params.externalAccountId, userId);
			const credential = await decryptCredential(c, row);
			const testResult = await getAdapter(row.provider).testConnection({ c, receive: row, send: row, credential });
			if (testResult?.credential) {
				await orm(c).update(externalAccount).set({ credential: await encryptCredential(c, testResult.credential), lastError: '', status: normalStatus }).where(eq(externalAccount.externalAccountId, row.externalAccountId)).run();
			}
		} else {
			const normalized = normalizeGenericParams(params);
			await genericAdapter.testConnection({ ...normalized, credential: { username: normalized.username, password: normalized.password } });
		}
		return true;
	},

	async update(c, params, userId) {
		const row = await this.getById(c, params.externalAccountId, userId);
		if (row.provider !== 'generic') throw new BizError('授权邮箱请重新授权');
		const normalized = normalizeGenericParams({ ...params, email: row.email });
		await genericAdapter.testConnection({ receive: normalized.receive, send: normalized.send, credential: normalized });
		const updated = await orm(c).update(externalAccount).set({
			username: normalized.username,
			receiveHost: normalized.receive.host,
			receivePort: normalized.receive.port,
			receiveSecurity: normalized.receive.security,
			sendHost: normalized.send.host,
			sendPort: normalized.send.port,
			sendSecurity: normalized.send.security,
			credential: await encryptCredential(c, { username: normalized.username, password: normalized.password }),
			status: normalStatus,
			lastError: ''
		}).where(eq(externalAccount.externalAccountId, row.externalAccountId)).returning().get();
		return sanitizeExternalAccount(updated);
	},

	async send(c, accountRow, params, userId) {
		if (accountRow.sourceType !== externalSourceType || accountRow.userId !== Number(userId)) {
			throw new BizError('外部邮箱账号不存在或无权限');
		}
		const row = await orm(c).select().from(externalAccount).where(and(
			eq(externalAccount.accountId, accountRow.accountId),
			eq(externalAccount.userId, Number(userId)),
			eq(externalAccount.isDel, normalStatus)
		)).get();
		if (!row) throw new BizError('外部邮箱账号不存在或无权限');
		let credential = await decryptCredential(c, row);
		const result = await getAdapter(row.provider).sendMessage({
			c,
			send: row,
			credential,
			message: buildExternalSendMessage(params, accountRow)
		});
		credential = result.credential || credential;
		if (result.credential) {
			await orm(c).update(externalAccount).set({ credential: await encryptCredential(c, credential), lastError: '', status: normalStatus }).where(eq(externalAccount.externalAccountId, row.externalAccountId)).run();
		}
		return { data: { id: result.remoteId || result.messageId || '' }, remoteThreadId: result.remoteThreadId || '' };
	},

	async saveExternalMessage(c, row, message) {
		const record = buildExternalMailRecord(message, row);
		const emailRow = await orm(c).insert(email).values(record).returning().get();
		const keys = [];
		try {
			for (const attachment of message.attachments || []) {
				const content = attachment.content instanceof ArrayBuffer ? attachment.content : attachment.content?.buffer || attachment.content;
				const key = `attachments/${await fileUtils.getBuffHash(content)}${fileUtils.getExtFileName(attachment.filename)}`;
				keys.push(key);
				await r2Service.putObj(c, key, content, {
					contentType: attachment.mimeType,
					contentDisposition: `${attachment.contentId ? 'inline' : 'attachment'};filename=${attachment.filename}`
				});
				await orm(c).insert(att).values({
					userId: row.userId,
					accountId: row.accountId,
					emailId: emailRow.emailId,
					key,
					filename: attachment.filename,
					mimeType: attachment.mimeType,
					size: content.byteLength ?? content.length ?? 0,
					disposition: attachment.disposition,
					related: attachment.related ? '1' : '0',
					contentId: attachment.contentId || null,
					type: attachment.contentId ? 1 : 0
				}).run();
			}
			await orm(c).insert(externalMessage).values({
				externalAccountId: row.externalAccountId,
				remoteId: message.remoteId,
				remoteThreadId: message.remoteThreadId || '',
				emailId: emailRow.emailId
			}).onConflictDoNothing().run();
			const mapping = await orm(c).select().from(externalMessage).where(and(
				eq(externalMessage.externalAccountId, row.externalAccountId),
				eq(externalMessage.remoteId, message.remoteId)
			)).get();
			if (mapping?.emailId !== emailRow.emailId) {
				await orm(c).delete(att).where(eq(att.emailId, emailRow.emailId)).run();
				await orm(c).delete(email).where(eq(email.emailId, emailRow.emailId)).run();
				for (const key of keys) {
					try { await r2Service.delete(c, key); } catch {}
				}
				return null;
			}
			return emailRow;
		} catch (error) {
			try { await orm(c).delete(att).where(eq(att.emailId, emailRow.emailId)).run(); } catch {}
			try { await orm(c).delete(email).where(eq(email.emailId, emailRow.emailId)).run(); } catch {}
			for (const key of keys) {
				try { await r2Service.delete(c, key); } catch {}
			}
			throw error;
		}
	},

	async sync(c, externalAccountId, userId) {
		const row = await this.getById(c, externalAccountId, userId);
		const adapter = getAdapter(row.provider);
		let credential = await decryptCredential(c, row);
		const listResult = await adapter.listMessages({ c, receive: row, credential, cursor: row.syncCursor, limit: 50 });
		credential = listResult.credential || credential;
		let added = 0;
		let skipped = 0;
		let failed = 0;
		for (const remote of listResult.messages || []) {
			try {
				const exists = await orm(c).select().from(externalMessage).where(and(
					eq(externalMessage.externalAccountId, row.externalAccountId),
					eq(externalMessage.remoteId, remote.remoteId)
				)).get();
				if (exists) {
					skipped++;
					continue;
				}
				const detail = await adapter.getMessage({ c, receive: row, credential, remoteId: remote.remoteId });
				const message = detail.message || detail;
				credential = detail.credential || credential;
				const saved = await this.saveExternalMessage(c, row, {
					...message,
					remoteId: message.remoteId || remote.remoteId,
					remoteThreadId: message.remoteThreadId || remote.remoteThreadId
				});
				if (!saved) {
					skipped++;
					continue;
				}
				added++;
			} catch {
				failed++;
			}
		}
		const cursor = failed ? (row.syncCursor || '') : (listResult.cursor || row.syncCursor || '');
		await orm(c).update(externalAccount).set({
			credential: await encryptCredential(c, credential),
			syncCursor: cursor || listResult.cursor || '',
			syncStatus: failed ? 1 : 0,
			lastSyncTime: new Date().toISOString(),
			lastError: failed ? `本次同步有 ${failed} 封邮件失败` : ''
		}).where(eq(externalAccount.externalAccountId, row.externalAccountId)).run();
		return { added, skipped, failed, cursor: cursor || listResult.cursor || '' };
	},

	async syncAll(c) {
		const rows = await orm(c).select().from(externalAccount).where(and(
			eq(externalAccount.status, normalStatus),
			eq(externalAccount.isDel, normalStatus)
		)).all();
		const result = [];
		for (const row of rows) {
			try {
				result.push(await this.sync(c, row.externalAccountId, row.userId));
			} catch {
				await orm(c).update(externalAccount).set({ syncStatus: 1, lastError: '同步失败' }).where(eq(externalAccount.externalAccountId, row.externalAccountId)).run();
			}
		}
		return result;
	},

	async delete(c, externalAccountId, userId) {
		const row = await this.getById(c, externalAccountId, userId);
		await orm(c).update(externalAccount).set({ isDel: 1, status: 1 }).where(eq(externalAccount.externalAccountId, row.externalAccountId)).run();
		await orm(c).update(account).set({ isDel: 1 }).where(and(eq(account.accountId, row.accountId), eq(account.userId, Number(userId)))).run();
	}
};

export {
	buildExternalMailRecord,
	buildExternalSendMessage,
	normalizeGenericParams,
	sanitizeExternalAccount
};
export default externalAccountService;
