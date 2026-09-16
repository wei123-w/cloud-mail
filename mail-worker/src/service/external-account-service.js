import BizError from '../error/biz-error.js';
import googleAdapter from './external-mail/google-adapter.js';
import microsoftAdapter from './external-mail/microsoft-adapter.js';

const adapters = { google: googleAdapter, microsoft: microsoftAdapter };

function getAdapter(provider) {
	const adapter = adapters[provider];
	if (!adapter) throw new BizError('暂不支持该邮箱服务商');
	return adapter;
}

const externalAccountService = {
	startAuthorization(c, provider, userId) {
		return getAdapter(provider).startAuthorization(c, userId);
	},

	completeAuthorization(c, provider, code, state, userId) {
		return getAdapter(provider).completeAuthorization(c, code, state, userId);
	},

	getAdapter
};

export default externalAccountService;
