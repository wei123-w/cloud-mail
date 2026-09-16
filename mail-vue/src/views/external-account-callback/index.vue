<template>
  <div class="callback"><el-result icon="info" :title="$t('bindingInProgress')" /></div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { externalAccountOAuthCallback } from '@/request/external-account.js'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()

onMounted(async () => {
  try {
    if (route.query.error) throw new Error(String(route.query.error))
    await externalAccountOAuthCallback({
      provider: route.query.provider || sessionStorage.getItem('externalOAuthProvider'),
      code: route.query.code,
      state: route.query.state
    })
    ElMessage({ message: t('bindSuccess'), type: 'success', plain: true })
  } catch {
    ElMessage({ message: t('bindFailed'), type: 'error', plain: true })
  } finally {
    sessionStorage.removeItem('externalOAuthProvider')
    await router.replace('/inbox')
  }
})
</script>

<style scoped>
.callback { display: flex; justify-content: center; align-items: center; height: 100vh; }
</style>
