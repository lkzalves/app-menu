export const environment = {
  production: false,
  // Mesma origem do app: o servidor de desenvolvimento repassa /api para a API (proxy.conf.json).
  // Assim o celular acessa o app por http://IP-do-PC:8100 sem precisar de CORS nem expor a porta 3000
  apiUrl: '/api',
};
