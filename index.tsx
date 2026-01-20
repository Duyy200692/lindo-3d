import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// Wrap render in try-catch logic (simplified for global errors)
try {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e) {
  console.error("Critical App Error:", e);
  rootElement.innerHTML = `
    <div style="padding: 20px; text-align: center; color: #ef4444; font-family: sans-serif;">
      <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 10px;">Đã xảy ra lỗi!</h1>
      <p>Vui lòng tải lại trang.</p>
      <pre style="background: #fef2f2; padding: 10px; border-radius: 8px; margin-top: 20px; overflow: auto; text-align: left;">${e instanceof Error ? e.message : 'Unknown Error'}</pre>
    </div>
  `;
}