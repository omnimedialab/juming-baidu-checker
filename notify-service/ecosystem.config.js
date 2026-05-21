// pm2 ecosystem - 通过 start.sh 加载 /opt/link113-notify/.env 里的环境变量
module.exports = {
  apps: [
    {
      name: 'link113-notify',
      script: './start.sh',
      cwd: '/opt/link113-notify',
      interpreter: 'bash',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
