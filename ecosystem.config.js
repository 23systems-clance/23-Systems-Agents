module.exports = {
  apps: [
    {
      name: 'event-handler',
      script: 'npm',
      args: 'run dev',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'worker',
      script: 'worker/index.js',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
