import { describe, expect, it } from 'vitest';
import mimeService from '../src/service/external-mail/mime-service.js';
import contracts from '../src/service/external-mail/contracts.js';

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
