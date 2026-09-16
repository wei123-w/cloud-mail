const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(value) {
	return btoa(String.fromCharCode(...new Uint8Array(value)));
}

function fromBase64(value) {
	return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function getKey(secret) {
	if (!secret || typeof secret !== 'string') {
		throw new Error('外部邮箱凭据加密密钥未配置');
	}

	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
	return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const credentialUtils = {
	async encrypt(value, secret) {
		if (value === undefined || value === null) {
			throw new Error('外部邮箱凭据不能为空');
		}

		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await getKey(secret);
		const encrypted = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			typeof value === 'string' ? encoder.encode(value) : encoder.encode(JSON.stringify(value))
		);

		return `v1.${toBase64(iv)}.${toBase64(encrypted)}`;
	},

	async decrypt(value, secret) {
		if (!value || typeof value !== 'string') {
			throw new Error('外部邮箱凭据格式无效');
		}

		const [version, ivValue, encryptedValue] = value.split('.');
		if (version !== 'v1' || !ivValue || !encryptedValue) {
			throw new Error('外部邮箱凭据格式无效');
		}

		const key = await getKey(secret);
		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromBase64(ivValue) },
			key,
			fromBase64(encryptedValue)
		);

		return decoder.decode(decrypted);
	}
};

export default credentialUtils;
