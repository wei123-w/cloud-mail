import { describe, expect, it } from 'vitest';
import {
	buildExternalMailRecord,
	buildExternalSendMessage,
	normalizeGenericParams,
	sanitizeExternalAccount
} from '../src/service/external-account-service.js';

describe('外部账号服务', () => {
	it('账号列表脱敏且不返回凭据和服务器密码', () => {
		const result = sanitizeExternalAccount({
			externalAccountId: 3,
			accountId: 8,
			userId: 42,
			email: 'other@example.com',
			provider: 'generic',
			authType: 'password',
			credential: '密文',
			receiveHost: 'imap.example.com',
			receivePort: 993,
			receiveSecurity: 'tls',
			sendHost: 'smtp.example.com',
			sendPort: 465,
			sendSecurity: 'tls',
			status: 0,
			syncStatus: 0,
			lastError: ''
		});

		expect(result).toMatchObject({ externalAccountId: 3, email: 'other@example.com', provider: 'generic' });
		expect(result).not.toHaveProperty('credential');
		expect(result).not.toHaveProperty('password');
	});

	it('通用账号参数默认使用安全端口并拒绝明文', () => {
		const result = normalizeGenericParams({
			email: 'other@example.com',
			username: 'other@example.com',
			password: '应用专用密码',
			receive: { host: 'imap.example.com', security: 'tls' },
			send: { host: 'smtp.example.com', security: 'tls' }
		});

		expect(result.receive.port).toBe(993);
		expect(result.send.port).toBe(465);
		expect(() => normalizeGenericParams({
			email: 'other@example.com',
			password: '应用专用密码',
			receive: { host: 'imap.example.com', security: 'none' },
			send: { host: 'smtp.example.com', security: 'tls' }
		})).toThrow('仅支持加密连接');
	});

	it('标准邮件可以转换为现有邮件表记录', () => {
		const result = buildExternalMailRecord({
			remoteId: 'remote-1',
			messageId: '<remote-1@example.com>',
			inReplyTo: '<parent@example.com>',
			relation: '<parent@example.com>',
			from: { address: 'sender@example.com', name: '发件人' },
			to: [{ address: 'bound@example.com', name: '收件人' }],
			cc: [{ address: 'copy@example.com', name: '抄送' }],
			bcc: [],
			subject: '主题',
			text: '正文',
			html: '<p>正文</p>',
			createTime: '2026-09-16T01:30:00.000Z'
		}, { accountId: 8, userId: 42 });

		expect(result).toMatchObject({
			accountId: 8,
			userId: 42,
			sendEmail: 'sender@example.com',
			toEmail: 'bound@example.com',
			subject: '主题',
			text: '正文',
			content: '<p>正文</p>',
			inReplyTo: '<parent@example.com>',
			relation: '<parent@example.com>',
			messageId: '<remote-1@example.com>'
		});
		expect(JSON.parse(result.recipient)).toEqual([{ address: 'bound@example.com', name: '收件人' }]);
		expect(JSON.parse(result.cc)).toEqual([{ address: 'copy@example.com', name: '抄送' }]);
	});

	it('外部发信消息会保留回复引用和附件', () => {
		const result = buildExternalSendMessage({
			name: '发件人',
			receiveEmail: ['one@example.com', 'two@example.com'],
			subject: '回复主题',
			text: '回复正文',
			html: '<p>回复正文</p>',
			attachments: [{ filename: 'a.txt', mimeType: 'text/plain', content: new Uint8Array([1, 2]) }],
			sendType: 'reply',
			messageId: '<old@example.com>'
		}, { email: 'bound@example.com' });

		expect(result).toMatchObject({
			from: { address: 'bound@example.com', name: '发件人' },
			inReplyTo: '<old@example.com>',
			relation: '<old@example.com>'
		});
		expect(result.to).toEqual([
			{ address: 'one@example.com', name: '' },
			{ address: 'two@example.com', name: '' }
		]);
		expect(result.attachments).toHaveLength(1);
	});
});
