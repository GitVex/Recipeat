<script setup lang="ts">
const { loggedIn, user, login, logout } = useOidcAuth()
const name = computed(() => String(user.value?.userInfo?.name || user.value?.userInfo?.preferred_username || 'Your account'))
</script>

<template>
  <div class="auth-controls">
    <template v-if="loggedIn">
      <span class="account-name" :title="name">{{ name }}</span>
      <button @click="logout('zitadel')">Sign out</button>
    </template>
    <button v-else @click="login('zitadel')">Sign in</button>
  </div>
</template>

<style scoped>
.auth-controls { display: flex; align-items: center; gap: 12px; }
.account-name { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; }
</style>
