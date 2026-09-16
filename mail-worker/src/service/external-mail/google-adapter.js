import BizError from '../../error/biz-error.js';
import mimeService from './mime-service.js';
import {
	completeAuthorization as completeOAuthAuthorization,
	getProviderConfig,
	readJson,
	requestWithCredential,
	startAuthorization as startOAuthAuthorization
} from './oauth-utils.js';

const provider = 'google';
const apiBase = 'https://gmail.googleapis.com/gmail/v1/users/me';

function startAuthorization(c, userId) {
	return startOAuthAuthorization(c, provider, userId, {
		scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send'
	});
}

async function completeAuthorization(c, code, state, userId) {
	return completeOAuthAuthorization(c, provider, code, state, userId, async accessToken => {
		const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		return readJson(response, '读取谷歌邮箱资料失败');
	});
}

function decodeBase64Url(value) {
	const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
	const binary = atob(normalized);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function encodeBase64Url(value) {
	const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function listMessages({ c, credential, cursor = '', limit = 50 }) {
	const query = new URLSearchParams({ maxResults: String(Math.min(Math.max(limit, 1), 100)) });
	if (cursor) query.set('pageToken', cursor);
	const result = await requestWithCredential(c, provider, credential, accessToken => fetch(`${apiBase}/messages?${query}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	}));
	const data = await readJson(result.response, '读取谷歌邮件列表失败');
	return {
		messages: (data.messages || []).map(item => ({ remoteId: item.id, remoteThreadId: item.threadId || '' })),
		cursor: data.nextPageToken || '',
		credential: result.credential
	};
}

async function getMessage({ c, credential, remoteId }) {
	const result = await requestWithCredential(c, provider, credential, accessToken => fetch(`${apiBase}/messages/${encodeURIComponent(remoteId)}?format=raw`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	}));
	const data = await readJson(result.response, '读取谷歌邮件详情失败');
	if (!data.raw) throw new BizError('谷歌邮件原文为空');
	return {
		message: await mimeService.parseRawMessage(decodeBase64Url(data.raw), {
			remoteId: data.id || remoteId,
			remoteThreadId: data.threadId || ''
		}),
		credential: result.credential
	};
}

async function sendMessage({ c, credential, message }) {
	const raw = mimeService.buildRawMessage(message);
	const result = await requestWithCredential(c, provider, credential, accessToken => fetch(`${apiBase}/messages/send`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ raw: encodeBase64Url(raw) })
	}));
	const data = await readJson(result.response, '谷歌邮箱发信失败');
	return { remoteId: data.id || '', remoteThreadId: data.threadId || '', credential: result.credential };
}

async function testConnection(input) {
	await listMessages({ ...input, limit: 1 });
	return true;
}

export default { startAuthorization, completeAuthorization, listMessages, getMessage, sendMessage, testConnection, getProviderConfig };
