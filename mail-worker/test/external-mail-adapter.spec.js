import { afterEach, describe, expect, it, vi } from 'vitest';
import mimeService from '../src/service/external-mail/mime-service.js';
import contracts from '../src/service/external-mail/contracts.js';
import googleAdapter from '../src/service/external-mail/google-adapter.js';
import microsoftAdapter from '../src/service/external-mail/microsoft-adapter.js';
import externalAccountService from '../src/service/external-account-service.js';

const rawMessage = [
	'From: 发件人 <sender@example.com>',
	'To: 收件人 <recipient@example.com>',
	'Cc: 抄送 <copy@example.com>',
	'Bcc: hidden@example.com',
	'Message-ID: <remote-1@example.com>',
	'In-Reply-To: <parent@example.com>',
	'References: <root@example.com> <parent@example.com>',
	'Subject: =?UTF-8?B?5rWL6K+V?=',
	'Date: Tue, 16 Sep 2026 09:30:00 +0800',
	'MIME-Version: 1.0',
	'Content-Type: multipart/mixed; boundary="mixed-boundary"',
	'',
	'--mixed-boundary',
	'Content-Type: text/plain; charset=utf-8',
	'',
	'正文内容',
	'--mixed-boundary',
	'Content-Type: application/pdf',
	'Content-Disposition: attachment; filename="报告.pdf"',
	'Content-ID: <file-1@example.com>',
	'Content-Transfer-Encoding: base64',
	'',
	'SGVsbG8=',
	'--mixed-boundary--',
	''
].join('\r\n');

describe('外部邮箱邮件标准化', () => {
	it('解析原始邮件并保留正文、地址、线程关系和附件', async () => {
		const message = await mimeService.parseRawMessage(rawMessage, {
			remoteId: 'remote-1',
			remoteThreadId: 'thread-1'
		});

		expect(message.remoteId).toBe('remote-1');
		expect(message.remoteThreadId).toBe('thread-1');
		expect(message.from).toEqual({ address: 'sender@example.com', name: '发件人' });
		expect(message.to).toEqual([{ address: 'recipient@example.com', name: '收件人' }]);
		expect(message.cc).toEqual([{ address: 'copy@example.com', name: '抄送' }]);
		expect(message.bcc).toEqual([{ address: 'hidden@example.com', name: '' }]);
		expect(message.subject).toBe('测试');
		expect(message.text).toContain('正文内容');
		expect(message.messageId).toBe('<remote-1@example.com>');
		expect(message.inReplyTo).toBe('<parent@example.com>');
		expect(message.relation).toContain('<root@example.com>');
		expect(message.relation).toContain('<parent@example.com>');
		expect(message.attachments).toHaveLength(1);
		expect(message.attachments[0].filename).toBe('报告.pdf');
		expect(message.attachments[0].mimeType).toBe('application/pdf');
		expect(message.attachments[0].contentId).toBe('<file-1@example.com>');
		expect(new TextDecoder().decode(message.attachments[0].content)).toBe('Hello');
	});

	it('地址标准化会去除缺省值并统一字段', () => {
		expect(contracts.normalizeAddress({ address: ' user@example.com ', name: null }))
			.toEqual({ address: 'user@example.com', name: '' });
		expect(contracts.normalizeAddresses(undefined)).toEqual([]);
	});

	it('构造的回复邮件可以再次被标准化解析', async () => {
		const raw = mimeService.buildRawMessage({
			from: { address: 'sender@example.com', name: '发件人' },
			to: [{ address: 'recipient@example.com', name: '收件人' }],
			subject: '回复主题',
			text: '回复正文',
			inReplyTo: '<remote-1@example.com>',
			relation: '<root@example.com> <remote-1@example.com>',
			attachments: [{
				filename: 'hello.txt',
				mimeType: 'text/plain',
				content: new TextEncoder().encode('附件内容')
			}]
		});
		const parsed = await mimeService.parseRawMessage(raw, {
			remoteId: 'local-reply',
			remoteThreadId: 'thread-1'
		});

		expect(parsed.subject).toBe('回复主题');
		expect(parsed.text).toContain('回复正文');
		expect(parsed.inReplyTo).toBe('<remote-1@example.com>');
		expect(parsed.relation).toContain('<root@example.com>');
		expect(parsed.attachments[0].filename).toBe('hello.txt');
		expect(new TextDecoder().decode(parsed.attachments[0].content)).toBe('附件内容');
	});
});

function createContext() {
	const values = new Map();
	return {
		values,
		context: {
			env: {
				EXTERNAL_CREDENTIAL_SECRET: '测试外部邮箱密钥',
				EXTERNAL_GOOGLE_CLIENT_ID: 'google-client',
				EXTERNAL_GOOGLE_CLIENT_SECRET: 'google-secret',
				EXTERNAL_GOOGLE_REDIRECT_URI: 'https://mail.example.com/oauth/google',
				EXTERNAL_MICROSOFT_CLIENT_ID: 'microsoft-client',
				EXTERNAL_MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
				EXTERNAL_MICROSOFT_REDIRECT_URI: 'https://mail.example.com/oauth/microsoft',
				kv: {
					put: vi.fn(async (key, value) => values.set(key, value)),
					get: vi.fn(async key => values.get(key) || null),
					delete: vi.fn(async key => values.delete(key))
				}
			}
		}
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('外部邮箱授权适配器', () => {
	it('授权状态绑定用户和服务商，回调后返回加密凭据', async () => {
		const { context, values } = createContext();
		const start = await externalAccountService.startAuthorization(context, 'google', 42);
		const stateData = JSON.parse([...values.values()][0]);

		expect(start.url).toContain('accounts.google.com');
		expect(stateData).toMatchObject({ userId: 42, provider: 'google' });
		expect(start.url).toContain(encodeURIComponent(start.state));

		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				access_token: 'access-token',
				refresh_token: 'refresh-token',
				expires_in: 3600,
				token_type: 'Bearer'
			}), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				email: 'bound@example.com',
				name: '绑定账号'
			}), { status: 200 })));

		const result = await externalAccountService.completeAuthorization(
			context,
			'google',
			'auth-code',
			start.state,
			42
		);

		expect(result).toMatchObject({ provider: 'google', email: 'bound@example.com' });
		expect(result.credential).not.toContain('access-token');
		expect(context.env.kv.delete).toHaveBeenCalledTimes(1);
	});

	it('错误用户不能消费授权状态', async () => {
		const { context } = createContext();
		const start = await googleAdapter.startAuthorization(context, 7);

		await expect(externalAccountService.completeAuthorization(
			context,
			'google',
			'auth-code',
			start.state,
			8
		)).rejects.toThrow('授权状态无效');
	});

	it('访问令牌失效时只刷新一次并继续请求', async () => {
		const { context } = createContext();
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				access_token: 'new-access-token',
				expires_in: 3600
			}), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				messages: [{ id: 'message-1', threadId: 'thread-1' }],
				nextPageToken: 'next-page'
			}), { status: 200 })));

		const credential = {
			accessToken: 'expired-access-token',
			refreshToken: 'refresh-token',
			expiresAt: 0
		};
		const result = await googleAdapter.listMessages({
			credential,
			limit: 10
		});

		expect(result.cursor).toBe('next-page');
		expect(result.messages[0]).toEqual({ remoteId: 'message-1', remoteThreadId: 'thread-1' });
		expect(result.credential.accessToken).toBe('new-access-token');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('微软授权地址使用图形接口权限', async () => {
		const { context } = createContext();
		const start = await microsoftAdapter.startAuthorization(context, 42);

		expect(start.url).toContain('login.microsoftonline.com');
		expect(start.url).toContain('Mail.ReadWrite');
		expect(start.url).toContain('Mail.Send');
	});
});
