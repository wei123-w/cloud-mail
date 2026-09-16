import { describe, expect, it } from 'vitest';
import { account } from '../src/entity/account.js';
import { externalAccount } from '../src/entity/external-account.js';
import { externalMessage } from '../src/entity/external-message.js';
import credentialUtils from '../src/utils/credential-utils.js';

describe('外部邮箱基础能力', () => {
	it('凭据加密后不能直接读出原文并且可以还原', async () => {
		const value = JSON.stringify({ password: '应用专用密码' });
		const encrypted = await credentialUtils.encrypt(value, '测试密钥');

		expect(encrypted).not.toContain('应用专用密码');
		expect(await credentialUtils.decrypt(encrypted, '测试密钥')).toBe(value);
	});

	it('旧账号默认属于本地邮箱', () => {
		expect(account.sourceType.default).toBe(0);
	});

	it('外部账号实体包含账号归属和同步状态字段', () => {
		expect(externalAccount.accountId).toBeDefined();
		expect(externalAccount.userId).toBeDefined();
		expect(externalAccount.provider).toBeDefined();
		expect(externalAccount.credential).toBeDefined();
		expect(externalAccount.syncCursor).toBeDefined();
		expect(externalAccount.status).toBeDefined();
	});

	it('远程邮件实体包含去重所需字段', () => {
		expect(externalMessage.externalAccountId).toBeDefined();
		expect(externalMessage.remoteId).toBeDefined();
		expect(externalMessage.emailId).toBeDefined();
	});
});
