import BizError from '../../error/biz-error.js';
import mimeService from './mime-service.js';

const allowedSecurity = new Set(['tls', 'ssl']);
const encoder = new TextEncoder();

function validateEndpoint(endpoint = {}, type) {
	const host = endpoint.host || endpoint[`${type}Host`];
	const security = String(endpoint.security || endpoint[`${type}Security`] || '').toLowerCase();
	if (!host || !allowedSecurity.has(security)) throw new BizError('仅支持加密连接');
	const defaultPort = type === 'receive' ? 993 : 465;
	return {
		host: String(host).trim(),
		port: Number(endpoint.port || endpoint[`${type}Port`] || defaultPort),
		security
	};
}

function getCredentialValue(credential, key) {
	return credential?.[key] ?? credential?.password ?? '';
}

async function getConnector(connect) {
	if (connect) return connect;
	const sockets = await import('cloudflare:sockets');
	return sockets.connect;
}

function encodeBase64(value) {
	const bytes = value instanceof Uint8Array ? value : encoder.encode(value);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

class TextSession {
	constructor(socket) {
		this.socket = socket;
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
		this.decoder = new TextDecoder();
		this.buffer = '';
	}

	async write(value) {
		await this.writer.write(encoder.encode(value));
	}

	async readChunk() {
		const result = await this.reader.read();
		if (result.done) throw new Error('连接已关闭');
		this.buffer += this.decoder.decode(result.value, { stream: true });
	}

	async readLine() {
		while (!this.buffer.includes('\r\n') && !this.buffer.includes('\n')) await this.readChunk();
		const match = this.buffer.match(/^(.*?)(?:\r\n|\n)/s);
		this.buffer = this.buffer.slice(match[0].length);
		return match[1];
	}

	async readTagged(tag) {
		const pattern = new RegExp(`(?:^|\\r?\\n)${tag} (?:OK|NO|BAD)\\b[^\\r\\n]*(?:\\r?\\n|$)`);
		while (!pattern.test(this.buffer)) await this.readChunk();
		const match = this.buffer.match(pattern);
		const end = match.index + match[0].length;
		const result = this.buffer.slice(0, end);
		this.buffer = this.buffer.slice(end);
		return result;
	}

	async readSmtp() {
		let result = '';
		while (true) {
			const line = await this.readLine();
			result += `${line}\r\n`;
			if (/^\d{3} /.test(line)) return result;
		}
	}

	async close() {
		try { await this.reader.cancel(); } catch {}
		try { await this.writer.close(); } catch {}
		try { await this.socket.close?.(); } catch {}
	}
}

function assertImapSuccess(response) {
	if (/(?:^|\r?\n)\w+ (?:NO|BAD)\b/i.test(response)) throw new Error('服务器拒绝收信操作');
}

function assertSmtpSuccess(response, expectedCode) {
	const code = Number(response.match(/^(\d{3})/)?.[1] || 0);
	if (code < 200 || code >= 400 || (expectedCode && code !== expectedCode)) throw new Error('服务器拒绝发信操作');
}

async function openSession(endpoint, type, connect) {
	const normalized = validateEndpoint(endpoint, type);
	const connector = await getConnector(connect);
	const socket = await connector(
		{ hostname: normalized.host, port: normalized.port },
		{ secureTransport: 'on' }
	);
	return new TextSession(socket);
}

async function loginImap(session, credential) {
	await session.readLine();
	const username = String(credential?.username || '');
	const password = String(getCredentialValue(credential, 'password'));
	const login = await imapCommand(session, 'LOGIN', `LOGIN "${username.replace(/"/g, '\\"')}" "${password.replace(/"/g, '\\"')}"`);
	assertImapSuccess(login);
}

async function imapCommand(session, command, body) {
	const tag = `a${command === 'LOGIN' ? '1' : command === 'SELECT' ? '2' : command === 'SEARCH' ? '3' : '4'}`;
	await session.write(`${tag} ${body}\r\n`);
	return session.readTagged(tag);
}

async function listMessages({ receive, credential, cursor = '', since = '', limit = 50, connect }) {
	let session;
	try {
		session = await openSession(receive, 'receive', connect);
		await loginImap(session, credential);
		const select = await imapCommand(session, 'SELECT', 'SELECT INBOX');
		assertImapSuccess(select);
		const start = `${Number(cursor) + 1}:*`;
		const search = since ? `UID SEARCH SINCE ${since}` : (cursor ? `UID SEARCH UID ${start}` : 'UID SEARCH ALL');
		const response = await imapCommand(session, 'SEARCH', search);
		assertImapSuccess(response);
		const ids = response.match(/(?:^|\r?\n)\* SEARCH\s*([^\r\n]*)/i)?.[1]
			.trim().split(/\s+/).filter(Boolean) || [];
		const limited = ids.slice(-Math.max(1, Math.min(Number(limit) || 50, 100)));
		return {
			messages: limited.map(remoteId => ({ remoteId, remoteThreadId: '' })),
			cursor: limited.at(-1) || cursor || ''
		};
	} catch (error) {
		if (error instanceof BizError) throw error;
		throw new BizError('外部邮箱收信失败');
	} finally {
		await session?.close();
	}
}

function extractLiteral(response) {
	const literal = response.match(/\{(\d+)\}\r?\n/);
	if (!literal) throw new Error('邮件原文格式错误');
	const prefix = new TextEncoder().encode(response.slice(0, literal.index + literal[0].length));
	const bytes = new TextEncoder().encode(response);
	return bytes.slice(prefix.length, prefix.length + Number(literal[1]));
}

async function getMessage({ receive, credential, remoteId, connect }) {
	let session;
	try {
		session = await openSession(receive, 'receive', connect);
		await loginImap(session, credential);
		const select = await imapCommand(session, 'SELECT', 'SELECT INBOX');
		assertImapSuccess(select);
		const tag = 'a4';
		await session.write(`${tag} UID FETCH ${remoteId} (UID RFC822)\r\n`);
		const response = await session.readTagged(tag);
		assertImapSuccess(response);
		return mimeService.parseRawMessage(extractLiteral(response), { remoteId: String(remoteId) });
	} catch (error) {
		if (error instanceof BizError) throw error;
		throw new BizError('外部邮箱收信失败');
	} finally {
		await session?.close();
	}
}

function normalizeSmtpRaw(raw) {
	return String(raw || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

async function sendMessage({ send, credential, message, connect }) {
	let session;
	try {
		session = await openSession(send, 'send', connect);
		assertSmtpSuccess(await session.readSmtp());
		await session.write('EHLO cloud-mail\r\n');
		assertSmtpSuccess(await session.readSmtp());
		const username = String(credential?.username || '');
		const password = String(getCredentialValue(credential, 'password'));
		await session.write(`AUTH PLAIN ${encodeBase64(`\0${username}\0${password}`)}\r\n`);
		assertSmtpSuccess(await session.readSmtp(), 235);
		await session.write(`MAIL FROM:<${message.from.address}>\r\n`);
		assertSmtpSuccess(await session.readSmtp());
		const recipients = [...(message.to || []), ...(message.cc || []), ...(message.bcc || [])];
		for (const recipient of recipients) {
			await session.write(`RCPT TO:<${recipient.address}>\r\n`);
			assertSmtpSuccess(await session.readSmtp());
		}
		await session.write('DATA\r\n');
		assertSmtpSuccess(await session.readSmtp(), 354);
		await session.write(`${normalizeSmtpRaw(mimeService.buildRawMessage(message))}\r\n.\r\n`);
		assertSmtpSuccess(await session.readSmtp());
		await session.write('QUIT\r\n');
		await session.readSmtp();
		return { remoteId: '', remoteThreadId: '' };
	} catch (error) {
		if (error instanceof BizError) throw error;
		throw new BizError('外部邮箱发信失败');
	} finally {
		await session?.close();
	}
}

async function testConnection({ receive, send, credential, connect }) {
	await listMessages({ receive, credential, limit: 1, connect });
	let session;
	try {
		session = await openSession(send, 'send', connect);
		assertSmtpSuccess(await session.readSmtp());
		await session.write('EHLO cloud-mail\r\n');
		assertSmtpSuccess(await session.readSmtp());
		const username = String(credential?.username || '');
		const password = String(getCredentialValue(credential, 'password'));
		await session.write(`AUTH PLAIN ${encodeBase64(`\0${username}\0${password}`)}\r\n`);
		assertSmtpSuccess(await session.readSmtp(), 235);
		await session.write('QUIT\r\n');
		await session.readSmtp();
	} catch {
		throw new BizError('外部邮箱连接测试失败');
	} finally {
		await session?.close();
	}
	return true;
}

export { getConnector, openSession, validateEndpoint };
export default { testConnection, listMessages, getMessage, sendMessage, validateEndpoint };
