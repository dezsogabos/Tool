<script setup>
import { useAuthStore } from './stores/auth'
import { useRouter, useRoute } from 'vue-router'
import { computed } from 'vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const isAuthenticated = computed(() => auth.isAuthenticated)
const currentRoute = computed(() => route.name)

const logout = () => {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div id="app">
    <!-- Navigation Bar -->
    <nav v-if="isAuthenticated" class="navbar">
      <div class="nav-container">
        <div class="nav-brand">
          <h1>Asset Review Tool</h1>
        </div>
        
        <div class="nav-tabs">
          <router-link 
            to="/" 
            class="nav-tab"
            :class="{ active: currentRoute === 'home' }"
          >
            🏠 Review
          </router-link>
          <router-link 
            to="/import" 
            class="nav-tab"
            :class="{ active: currentRoute === 'import' }"
          >
            📁 Import
          </router-link>
        </div>
        
        <div class="nav-actions">
          <button @click="logout" class="logout-btn">
            🚪 Logout
          </button>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
#app {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.navbar {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 1000;
}

.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 70px;
}

.nav-brand h1 {
  margin: 0;
  font-size: 24px;
  font-weight: bold;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nav-tabs {
  display: flex;
  gap: 10px;
}

.nav-tab {
  padding: 12px 20px;
  text-decoration: none;
  color: #666;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
  border: 2px solid transparent;
}

.nav-tab:hover {
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
  transform: translateY(-1px);
}

.nav-tab.active {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.nav-actions {
  display: flex;
  align-items: center;
}

.logout-btn {
  background: linear-gradient(135deg, #e74c3c, #c0392b);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.logout-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
}

.main-content {
  padding: 20px;
  min-height: calc(100vh - 70px);
}

/* Responsive Design */
@media (max-width: 768px) {
  .nav-container {
    flex-direction: column;
    height: auto;
    padding: 15px 20px;
    gap: 15px;
  }
  
  .nav-tabs {
    order: 2;
  }
  
  .nav-actions {
    order: 3;
  }
  
  .nav-brand {
    order: 1;
  }
  
  .nav-brand h1 {
    font-size: 20px;
  }
  
  .nav-tab {
    padding: 10px 15px;
    font-size: 14px;
  }
}
</style>
