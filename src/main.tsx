import { initializeNativeRuntime } from './platform/nativeRuntime'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

void initializeNativeRuntime()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
