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
		html: String(parsed.html || ''),
		createTime: parsed.date || new Date().toISOString(),
		attachments: Array.isArray(parsed.attachments) ? parsed.attachments.map(normalizeAttachment) : []
	};
}

export { normalizeAddress, normalizeAddresses, normalizeParsedMessage, normalizeReferences };
export default {
	normalizeAddress,
	normalizeAddresses,
	normalizeParsedMessage,
	normalizeReferences
};
