const { execSync } = require('child_process');

try {
  const port = process.env.PORT || 5000;
  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`
    );
  } else {
    execSync(`npx -y kill-port ${port}`);
  }
} catch {
  // Ignore errors if no process is using port 5000
}
