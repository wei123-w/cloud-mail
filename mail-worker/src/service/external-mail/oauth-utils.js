import BizError from '../../error/biz-error.js';
import credentialUtils from '../../utils/credential-utils.js';

const statePrefix = 'external-mail-oauth:';

function getEnv(c, key, fallback = '') {
	return c?.env?.[key] ?? fallback;
}

function getProviderConfig(c, provider) {
	const upper = provider === 'google' ? 'GOOGLE' : 'MICROSOFT';
	const defaults = provider === 'google'
		? {
			authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
			tokenUrl: 'https://oauth2.googleapis.com/token',
			clientId: getEnv(c, 'googleClientId'),
			clientSecret: getEnv(c, 'googleClientSecret'),
			redirectUri: getEnv(c, 'googleRedirectUri')
		}
		: {
			authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
			tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
			clientId: getEnv(c, 'microsoftClientId'),
			clientSecret: getEnv(c, 'microsoftClientSecret'),
			redirectUri: getEnv(c, 'microsoftRedirectUri')
		};
	return {
		...defaults,
		clientId: getEnv(c, `EXTERNAL_${upper}_CLIENT_ID`, defaults.clientId),
		clientSecret: getEnv(c, `EXTERNAL_${upper}_CLIENT_SECRET`, defaults.clientSecret),
		redirectUri: getEnv(c, `EXTERNAL_${upper}_REDIRECT_URI`, defaults.redirectUri)
	};
}

function getCredentialSecret(c) {
	const secret = getEnv(c, 'EXTERNAL_CREDENTIAL_SECRET');
	if (!secret) throw new BizError('外部邮箱凭据密钥未配置');
	return secret;
}

function randomToken() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}

function stateKey(state) {
	return statePrefix + state;
}

async function startAuthorization(c, provider, userId, params = {}) {
	const config = getProviderConfig(c, provider);
	if (!config.clientId || !config.redirectUri) throw new BizError('外部邮箱授权配置不完整');
	const state = randomToken();
	const stateData = { userId: Number(userId), provider, nonce: randomToken() };
	await c.env.kv.put(stateKey(state), JSON.stringify(stateData), { expirationTtl: 600 });
	const query = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: 'code',
		state,
		scope: params.scope
	});
	if (provider === 'google') {
		query.set('access_type', 'offline');
		query.set('prompt', 'consent');
	}
	return { url: `${config.authorizeUrl}?${query.toString()}`, state };
}

async function consumeAuthorizationState(c, provider, state, userId) {
	if (!state) throw new BizError('授权状态无效');
	const raw = await c.env.kv.get(stateKey(state));
	await c.env.kv.delete(stateKey(state));
	if (!raw) throw new BizError('授权状态无效');
	let stateData;
	try {
		stateData = JSON.parse(raw);
	} catch {
		throw new BizError('授权状态无效');
	}
	if (stateData.provider !== provider || Number(stateData.userId) !== Number(userId)) {
		throw new BizError('授权状态无效');
	}
	return stateData;
}

async function readJson(response, errorMessage) {
	let data = null;
	try {
		data = await response.json();
	} catch {
		data = null;
	}
	if (!response.ok) throw new BizError(errorMessage);
	return data || {};
}

async function exchangeCode(c, provider, code) {
	const config = getProviderConfig(c, provider);
	const response = await fetch(config.tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			redirect_uri: config.redirectUri,
			grant_type: 'authorization_code'
		}).toString()
	});
	const token = await readJson(response, '外部邮箱授权换令牌失败');
	if (!token.access_token) throw new BizError('外部邮箱授权换令牌失败');
	return {
		accessToken: token.access_token,
		refreshToken: token.refresh_token || '',
		expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
		tokenType: token.token_type || 'Bearer'
	};
}

async function encryptCredential(c, credential) {
	return credentialUtils.encrypt(JSON.stringify(credential), getCredentialSecret(c));
}

async function refreshCredential(c, provider, credential) {
	if (!credential?.refreshToken) throw new BizError('外部邮箱令牌已失效');
	const config = getProviderConfig(c, provider);
	const response = await fetch(config.tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			refresh_token: credential.refreshToken,
			grant_type: 'refresh_token'
		}).toString()
	});
	const token = await readJson(response, '外部邮箱令牌刷新失败');
	if (!token.access_token) throw new BizError('外部邮箱令牌刷新失败');
	return {
		...credential,
		accessToken: token.access_token,
		refreshToken: token.refresh_token || credential.refreshToken,
		expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
		tokenType: token.token_type || credential.tokenType || 'Bearer'
	};
}

async function requestWithCredential(c, provider, credential, request) {
	let current = { ...credential };
	let refreshed = false;
	if (current.expiresAt !== undefined && current.expiresAt !== null && Number(current.expiresAt) <= Date.now()) {
		current = await refreshCredential(c, provider, current);
		refreshed = true;
	}
	let response = await request(current.accessToken);
	if (response.status === 401 && current.refreshToken && !refreshed) {
		current = await refreshCredential(c, provider, current);
		refreshed = true;
		response = await request(current.accessToken);
	}
	return { response, credential: current };
}

async function completeAuthorization(c, provider, code, state, userId, loadProfile) {
	await consumeAuthorizationState(c, provider, state, userId);
	const credentialData = await exchangeCode(c, provider, code);
	const profile = await loadProfile(credentialData.accessToken);
	if (!profile?.email) throw new BizError('外部邮箱未返回邮箱地址');
	return {
		provider,
		authType: 'oauth2',
		email: profile.email,
		name: profile.name || profile.email,
		credential: await encryptCredential(c, credentialData)
	};
}

export {
	completeAuthorization,
	consumeAuthorizationState,
	encryptCredential,
	exchangeCode,
	getCredentialSecret,
	getProviderConfig,
	readJson,
	refreshCredential,
	requestWithCredential,
	startAuthorization
};
