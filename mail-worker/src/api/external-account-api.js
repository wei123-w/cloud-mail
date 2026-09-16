import app from '../hono/hono.js';
import result from '../model/result.js';
import userContext from '../security/user-context.js';
import externalAccountService from '../service/external-account-service.js';

app.get('/external-account/list', async c => {
	return c.json(result.ok(await externalAccountService.list(c, userContext.getUserId(c))));
});

app.post('/external-account/add', async c => {
	return c.json(result.ok(await externalAccountService.addGeneric(c, await c.req.json(), userContext.getUserId(c))));
});

app.post('/external-account/test', async c => {
	return c.json(result.ok(await externalAccountService.test(c, await c.req.json(), userContext.getUserId(c))));
});

app.post('/external-account/oauth/start', async c => {
	const params = await c.req.json();
	return c.json(result.ok(await externalAccountService.startOAuth(c, params.provider, userContext.getUserId(c))));
});

app.post('/external-account/oauth/callback', async c => {
	return c.json(result.ok(await externalAccountService.completeOAuth(c, await c.req.json(), userContext.getUserId(c))));
});

app.post('/external-account/reauthorize', async c => {
	return c.json(result.ok(await externalAccountService.completeOAuth(c, await c.req.json(), userContext.getUserId(c))));
});

app.post('/external-account/sync', async c => {
	const params = await c.req.json();
	return c.json(result.ok(await externalAccountService.sync(c, params.externalAccountId, userContext.getUserId(c))));
});

app.put('/external-account/update', async c => {
	return c.json(result.ok(await externalAccountService.update(c, await c.req.json(), userContext.getUserId(c))));
});

app.delete('/external-account/delete', async c => {
	const params = c.req.query();
	await externalAccountService.delete(c, params.externalAccountId, userContext.getUserId(c));
	return c.json(result.ok());
});
