// Helper to get environment variables safely across Vite, Create React App, and standard Process environments.
export const getEnv = (key: string): string => {
  // 1. Try Vite standard (import.meta.env)
  try {
    // @ts-ignore
    if (import.meta && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) {
    // Ignore error if import.meta is not available
  }

  // 2. Try Process Env (Standard / CRA)
  try {
    if (typeof process !== 'undefined' && process.env) {
      // Support both direct key and REACT_APP_ prefix fallback
      if (process.env[key]) return process.env[key];
      
      const reactAppKey = `REACT_APP_${key.replace(/^VITE_/, '')}`;
      if (process.env[reactAppKey]) return process.env[reactAppKey];
    }
  } catch (e) {
     // Ignore
  }

  return '';
};