// PM2 Ecosystem Configuration
// Start both services:  pm2 start ecosystem.config.cjs
// Monitor:              pm2 monit
// Logs:                 pm2 logs
// Restart all:          pm2 restart all
// Save for reboot:      pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name: "nextjs",
      script: "npm",
      args: "run start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      error_file: "./logs/nextjs-error.log",
      out_file: "./logs/nextjs-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "go-backend",
      script: "./app/api/go/disc-tracking",  // compiled binary (Linux)
      cwd: __dirname,
      env: {
        GIN_MODE: "release",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      error_file: "./logs/go-error.log",
      out_file: "./logs/go-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
