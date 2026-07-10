const path = require('node:path');
const windowsPath = path.win32;

const WINDOWS_SHELL_META = /[&|<>()^%!`]/;
const PORTABLE_EXECUTABLE_PATTERN = /^Freaky[ .-]IPTV-\d+\.\d+\.\d+-Portable-x64\.exe$/i;

function isSafePortableExecutablePath(filePath) {
  return typeof filePath === 'string' &&
    windowsPath.isAbsolute(filePath) &&
    windowsPath.extname(filePath).toLowerCase() === '.exe' &&
    !WINDOWS_SHELL_META.test(filePath) &&
    PORTABLE_EXECUTABLE_PATTERN.test(windowsPath.basename(filePath));
}

function assertSafePath(filePath, label, extension) {
  if (typeof filePath !== 'string' || !windowsPath.isAbsolute(filePath) || WINDOWS_SHELL_META.test(filePath)) {
    throw new TypeError(`${label} must be a safe absolute path.`);
  }
  if (extension && windowsPath.extname(filePath).toLowerCase() !== extension) {
    throw new TypeError(`${label} must use the ${extension} extension.`);
  }
  return windowsPath.resolve(filePath);
}

function createPortableReplacementPlan({ executablePath, downloadedPath, pid }) {
  const applicationPath = assertSafePath(executablePath, 'Portable executable', '.exe');
  const updatePath = assertSafePath(downloadedPath, 'Downloaded update');
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('Process id must be a positive integer.');
  if (windowsPath.dirname(applicationPath) !== windowsPath.dirname(updatePath)) {
    throw new RangeError('Portable update files must be in the same directory.');
  }

  const backupPath = windowsPath.join(windowsPath.dirname(applicationPath), `.${windowsPath.basename(applicationPath)}.previous`);
  const scriptPath = windowsPath.join(windowsPath.dirname(applicationPath), `.${windowsPath.basename(applicationPath)}.update-${pid}.cmd`);
  const script = `@echo off\r\n` +
    `setlocal DisableDelayedExpansion\r\n` +
    `:wait_for_freaky_iptv\r\n` +
    `tasklist /FI "PID eq ${pid}" /NH | find "${pid}" >nul\r\n` +
    `if not errorlevel 1 (\r\n` +
    `  timeout /t 1 /nobreak >nul\r\n` +
    `  goto wait_for_freaky_iptv\r\n` +
    `)\r\n` +
    `if exist "${backupPath}" del /F /Q "${backupPath}"\r\n` +
    `move /Y "${applicationPath}" "${backupPath}"\r\n` +
    `if errorlevel 1 goto failed\r\n` +
    `move /Y "${updatePath}" "${applicationPath}"\r\n` +
    `if errorlevel 1 goto restore\r\n` +
    `start "" "${applicationPath}"\r\n` +
    `del "%~f0"\r\n` +
    `exit /b 0\r\n` +
    `:restore\r\n` +
    `move /Y "${backupPath}" "${applicationPath}"\r\n` +
    `:failed\r\n` +
    `del /F /Q "${updatePath}"\r\n` +
    `del "%~f0"\r\n` +
    `exit /b 1\r\n`;

  return { applicationPath, backupPath, scriptPath, script };
}

module.exports = {
  createPortableReplacementPlan,
  isSafePortableExecutablePath
};
