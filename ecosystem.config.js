module.exports = {
  apps: [
    {
      name: 'cssrms',
      script: 'serve.js',
      cwd: '/var/www/cssrms',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/pm2/cssrms-error.log',
      out_file: '/var/log/pm2/cssrms-out.log',
      merge_logs: true,
    },
  ],
};
