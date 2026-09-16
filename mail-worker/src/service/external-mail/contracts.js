const emptyAddress = { address: '', name: '' };

function normalizeAddress(value) {
	if (!value) return { ...emptyAddress };
	if (typeof value === 'string') {
		return { address: value.trim(), name: '' };
	}
	return {
		address: String(value.address || '').trim(),
		name: String(value.name || '').trim()
	};
}

function normalizeAddresses(value) {
	if (!Array.isArray(value)) return [];
	return value.flat(Infinity).filter(Boolean).map(normalizeAddress).filter(item => item.address);
}

function normalizeReferences(value) {
	if (Array.isArray(value)) return value.filter(Boolean).join(' ').trim();
	return String(value || '').trim();
}

function sanitizeHtml(value) {
	return String(value || '')
		.replace(/<\s*(script|iframe|object|embed|form|meta|link)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
		.replace(/<\s*(script|iframe|object|embed|form|meta|link)[^>]*\/?>/gi, '')
		.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(/\s+(href|src|action|formaction)\s*=\s*(["'])\s*javascript\s*:[\s\S]*?\2/gi, ' $1="#"')
		.replace(/\b(href|src|action|formaction)\s*=\s*(["']?)\s*javascript\s*:[^\s'">]*\2/gi, '$1="#"');
}

function normalizeAttachment(item = {}) {
	return {
		filename: String(item.filename || '附件').trim(),
		mimeType: String(item.mimeType || 'application/octet-stream').trim(),
		disposition: item.disposition || 'attachment',
		related: Boolean(item.related),
		contentId: String(item.contentId || '').trim(),
		content: item.content ?? new ArrayBuffer(0)
	};
}

function normalizeParsedMessage(parsed = {}, metadata = {}) {
	return {
		remoteId: String(metadata.remoteId || '').trim(),
		remoteThreadId: String(metadata.remoteThreadId || '').trim(),
		messageId: String(parsed.messageId || '').trim(),
		inReplyTo: String(parsed.inReplyTo || '').trim(),
		relation: normalizeReferences(parsed.references),
		from: normalizeAddress(parsed.from),
		to: normalizeAddresses(parsed.to),
		cc: normalizeAddresses(parsed.cc),
		bcc: normalizeAddresses(parsed.bcc),
		subject: String(parsed.subject || '').trim(),
		text: String(parsed.text || ''),
		html: sanitizeHtml(parsed.html),
		createTime: parsed.date || new Date().toISOString(),
		attachments: Array.isArray(parsed.attachments) ? parsed.attachments.map(normalizeAttachment) : []
	};
}

export { normalizeAddress, normalizeAddresses, normalizeParsedMessage, normalizeReferences, sanitizeHtml };
export default {
	normalizeAddress,
	normalizeAddresses,
	normalizeParsedMessage,
	normalizeReferences,
	sanitizeHtml
};
