import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isAuthenticated: false,
    username: '',
  }),
  actions: {
    async login(inputUsername, inputPassword) {
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: inputUsername, password: inputPassword }),
        })
        const data = await res.json()
        const isValid = !!data?.ok
        this.isAuthenticated = isValid
        this.username = isValid ? inputUsername : ''
        return isValid
      } catch (_) {
        return false
      }
    },
    logout() {
      this.isAuthenticated = false
      this.username = ''
    },
  },
  persist: false,
})


