import PostalMime from 'postal-mime';
import { normalizeParsedMessage } from './contracts.js';

function toUint8Array(content) {
	if (content instanceof Uint8Array) return content;
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	if (typeof content === 'string') return new TextEncoder().encode(content);
	if (content?.buffer instanceof ArrayBuffer) {
		return new Uint8Array(content.buffer, content.byteOffset || 0, content.byteLength);
	}
	return new Uint8Array(0);
}

function encodeBase64(content) {
	const bytes = toUint8Array(content);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

function encodeHeader(value) {
	const text = String(value || '');
	if (/^[\x20-\x7e]*$/.test(text)) return text;
	return `=?UTF-8?B?${encodeBase64(new TextEncoder().encode(text))}?=`;
}

function formatAddress(value) {
	const address = value?.address?.trim();
	if (!address) return '';
	const name = value?.name?.trim();
	return name ? `${encodeHeader(name)} <${address}>` : address;
}

function formatAddressList(values = []) {
	return values.map(formatAddress).filter(Boolean).join(', ');
}

function buildRawMessage(message = {}) {
	const headers = [
		`From: ${formatAddress(message.from)}`,
		`To: ${formatAddressList(message.to)}`,
		...(message.cc?.length ? [`Cc: ${formatAddressList(message.cc)}`] : []),
		...(message.bcc?.length ? [`Bcc: ${formatAddressList(message.bcc)}`] : []),
		`Subject: ${encodeHeader(message.subject)}`,
		...(message.messageId ? [`Message-ID: ${message.messageId}`] : []),
		...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`] : []),
		...(message.relation ? [`References: ${message.relation}`] : []),
		'MIME-Version: 1.0'
	];

	const attachments = Array.isArray(message.attachments) ? message.attachments : [];
	if (!attachments.length) {
		return `${headers.join('\r\n')}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${message.text || ''}`;
	}

	const boundary = `external-mail-${crypto.randomUUID?.() || Date.now()}`;
	const body = [
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		'',
		`--${boundary}`,
		'Content-Type: text/plain; charset=utf-8',
		'Content-Transfer-Encoding: 8bit',
		'',
		message.text || '',
		...attachments.flatMap(attachment => [
			`--${boundary}`,
			`Content-Type: ${attachment.mimeType || 'application/octet-stream'}; name="${encodeHeader(attachment.filename || '附件')}"`,
			`Content-Disposition: ${attachment.disposition || 'attachment'}; filename="${encodeHeader(attachment.filename || '附件')}"`,
			...(attachment.contentId ? [`Content-ID: ${attachment.contentId}`] : []),
			'Content-Transfer-Encoding: base64',
			'',
			encodeBase64(attachment.content)
		]),
		`--${boundary}--`,
		''
	].join('\r\n');

	return `${headers.join('\r\n')}\r\n${body}`;
}

async function parseRawMessage(raw, metadata = {}) {
	const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
	return normalizeParsedMessage(parsed, metadata);
}

export { buildRawMessage, parseRawMessage, toUint8Array };
export default { buildRawMessage, parseRawMessage, toUint8Array };
