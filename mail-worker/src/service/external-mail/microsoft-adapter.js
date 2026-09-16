import mimeService from './mime-service.js';
import {
	completeAuthorization as completeOAuthAuthorization,
	getProviderConfig,
	readJson,
	requestWithCredential,
	startAuthorization as startOAuthAuthorization
} from './oauth-utils.js';

const provider = 'microsoft';
const apiBase = 'https://graph.microsoft.com/v1.0';

function encodeBase64(content) {
		const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content || '');
		let binary = '';
		for (let index = 0; index < bytes.length; index += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
		}
		return btoa(binary);
}

function startAuthorization(c, userId) {
	return startOAuthAuthorization(c, provider, userId, {
		scope: 'openid profile email offline_access Mail.ReadWrite Mail.Send'
	});
}

async function completeAuthorization(c, code, state, userId) {
	return completeOAuthAuthorization(c, provider, code, state, userId, async accessToken => {
		const response = await fetch(`${apiBase}/me`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		return readJson(response, '读取微软邮箱资料失败');
	});
}

async function listMessages({ c, credential, cursor = '', limit = 50 }) {
	const url = cursor || `${apiBase}/me/mailFolders/inbox/messages?$top=${Math.min(Math.max(limit, 1), 100)}&$select=id,conversationId`;
	const result = await requestWithCredential(c, provider, credential, accessToken => fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` }
	}));
	const data = await readJson(result.response, '读取微软邮件列表失败');
	return {
		messages: (data.value || []).map(item => ({ remoteId: item.id, remoteThreadId: item.conversationId || '' })),
		cursor: data['@odata.nextLink'] || '',
		credential: result.credential
	};
}

async function getMessage({ c, credential, remoteId }) {
	const result = await requestWithCredential(c, provider, credential, accessToken => fetch(`${apiBase}/me/messages/${encodeURIComponent(remoteId)}/$value`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	}));
	if (!result.response.ok) throw new Error('读取微软邮件详情失败');
	return {
		message: await mimeService.parseRawMessage(await result.response.arrayBuffer(), { remoteId }),
		credential: result.credential
	};
}

async function sendMessage({ c, credential, message }) {
	const result = await requestWithCredential(c, provider, credential, accessToken => fetch(`${apiBase}/me/sendMail`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			message: {
				subject: message.subject || '',
				body: { contentType: message.html ? 'HTML' : 'Text', content: message.html || message.text || '' },
				toRecipients: (message.to || []).map(item => ({ emailAddress: { address: item.address, name: item.name } })),
				ccRecipients: (message.cc || []).map(item => ({ emailAddress: { address: item.address, name: item.name } })),
				attachments: (message.attachments || []).map(item => ({
					'@odata.type': '#microsoft.graph.fileAttachment',
					name: item.filename,
					contentType: item.mimeType || 'application/octet-stream',
					contentBytes: encodeBase64(item.content)
				}))
			}
		})
	}));
	if (!result.response.ok) throw new Error('微软邮箱发信失败');
	return { remoteId: '', remoteThreadId: '', credential: result.credential };
}

async function testConnection(input) {
	await listMessages({ ...input, limit: 1 });
	return true;
}

export default { startAuthorization, completeAuthorization, listMessages, getMessage, sendMessage, testConnection, getProviderConfig };
