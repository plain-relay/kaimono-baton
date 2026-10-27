import { isNativeApp } from './platform/runtime'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

if (isNativeApp()) {
  document.documentElement.classList.add('native-app')
  void import('./platform/nativeRuntime').then(({ initializeNativeRuntime }) => initializeNativeRuntime())
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
