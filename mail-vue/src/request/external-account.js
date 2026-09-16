import http from '@/axios/index.js'

export function externalAccountList() {
    return http.get('/external-account/list', {noMsg: true})
}

export function externalAccountAdd(form) {
    return http.post('/external-account/add', form)
}

export function externalAccountTest(form) {
    return http.post('/external-account/test', form, {noMsg: true})
}

export function externalAccountSync(externalAccountId) {
    return http.post('/external-account/sync', {externalAccountId}, {noMsg: true})
}

export function externalAccountUpdate(form) {
    return http.put('/external-account/update', form)
}

export function externalAccountDelete(externalAccountId) {
    return http.delete('/external-account/delete', {params: {externalAccountId}})
}

export function externalAccountOAuthStart(provider) {
    return http.post('/external-account/oauth/start', {provider}, {noMsg: true})
}

export function externalAccountOAuthCallback(form) {
    return http.post('/external-account/oauth/callback', form, {noMsg: true})
}
