<template>
  <el-dialog :model-value="modelValue" :title="$t('bindExternalAccount')" width="520px" @close="close">
    <el-form label-position="top" :model="form">
      <el-form-item :label="$t('externalProvider')">
        <el-radio-group v-model="provider">
          <el-radio-button label="google">Google</el-radio-button>
          <el-radio-button label="microsoft">Microsoft</el-radio-button>
          <el-radio-button label="generic">{{ $t('genericMailbox') }}</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <template v-if="provider !== 'generic'">
        <el-alert :title="$t('oauthBindHint')" type="info" :closable="false" show-icon />
        <el-button class="submit" type="primary" :loading="loading" @click="startOAuth">
          {{ $t('continueProviderAuth') }}
        </el-button>
      </template>

      <template v-else>
        <el-form-item :label="$t('externalEmail')" required>
          <el-input v-model="form.email" type="email" autocomplete="off" />
        </el-form-item>
        <el-form-item :label="$t('externalUsername')" required>
          <el-input v-model="form.username" autocomplete="off" />
        </el-form-item>
        <el-form-item :label="$t('externalPassword')" required>
          <el-input v-model="form.password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="16">
            <el-form-item :label="$t('receiveServer')" required>
              <el-input v-model="form.receive.host" placeholder="imap.example.com" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item :label="$t('port')">
              <el-input-number v-model="form.receive.port" :min="1" :max="65535" controls-position="right" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="16">
            <el-form-item :label="$t('sendServer')" required>
              <el-input v-model="form.send.host" placeholder="smtp.example.com" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item :label="$t('port')">
              <el-input-number v-model="form.send.port" :min="1" :max="65535" controls-position="right" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item :label="$t('receiveSecurity')">
              <el-select v-model="form.receive.security" class="full">
                <el-option label="TLS" value="tls" />
                <el-option label="SSL" value="ssl" />
                <el-option label="STARTTLS" value="starttls" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('sendSecurity')">
              <el-select v-model="form.send.security" class="full">
                <el-option label="TLS" value="tls" />
                <el-option label="SSL" value="ssl" />
                <el-option label="STARTTLS" value="starttls" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-button class="submit" type="primary" :loading="loading" @click="submitGeneric">
          {{ $t('testAndBind') }}
        </el-button>
      </template>
    </el-form>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { externalAccountAdd, externalAccountOAuthStart } from '@/request/external-account.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'saved'])
const { t } = useI18n()
const provider = ref('google')
const loading = ref(false)
const form = reactive({
  email: '',
  username: '',
  password: '',
  receive: { host: '', port: 993, security: 'tls' },
  send: { host: '', port: 465, security: 'tls' }
})

watch(() => props.modelValue, value => {
  if (value) {
    provider.value = 'google'
    form.email = ''
    form.username = ''
    form.password = ''
  }
})

function close() {
  emit('update:modelValue', false)
}

async function startOAuth() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await externalAccountOAuthStart(provider.value)
    sessionStorage.setItem('externalOAuthProvider', provider.value)
    window.location.href = result.url
  } finally {
    loading.value = false
  }
}

async function submitGeneric() {
  if (loading.value) return
  if (!form.email || !form.username || !form.password || !form.receive.host || !form.send.host) {
    ElMessage({ message: t('externalRequired'), type: 'warning', plain: true })
    return
  }
  loading.value = true
  try {
    await externalAccountAdd({ ...form, provider: 'generic' })
    ElMessage({ message: t('bindSuccess'), type: 'success', plain: true })
    emit('saved')
    close()
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.submit { width: 100%; margin-top: 8px; }
.full { width: 100%; }
</style>
