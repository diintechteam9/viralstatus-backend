/**
 * Google Auth Logging Utility
 * Tracks all Google authentication attempts and errors
 */

const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, 'google-auth.log');

const getTimestamp = () => new Date().toISOString();

const logGoogleAuthAttempt = (email, role, status, details = {}) => {
  const logEntry = {
    timestamp: getTimestamp(),
    email,
    role,
    status,
    details
  };

  const logMessage = `[${logEntry.timestamp}] ${status.toUpperCase()} | Email: ${email} | Role: ${role} | Details: ${JSON.stringify(details)}\n`;

  // Write to file
  fs.appendFileSync(logFile, logMessage);

  // Also log to console in development
  if (process.env.NODE_ENV === 'development') {
    const color = status === 'success' ? '\x1b[32m' : '\x1b[31m'; // Green for success, Red for error
    const reset = '\x1b[0m';
    console.log(`${color}[GoogleAuth] ${logMessage.trim()}${reset}`);
  }

  return logEntry;
};

const logGoogleAuthError = (email, error, context = {}) => {
  const errorEntry = {
    timestamp: getTimestamp(),
    email,
    error: error.message,
    stack: error.stack,
    context
  };

  const logMessage = `[${errorEntry.timestamp}] ERROR | Email: ${email} | Error: ${error.message} | Context: ${JSON.stringify(context)}\n`;

  fs.appendFileSync(logFile, logMessage);

  if (process.env.NODE_ENV === 'development') {
    console.error('\x1b[31m[GoogleAuth Error]\x1b[0m', logMessage.trim());
  }

  return errorEntry;
};

const getGoogleAuthLogs = (limit = 100) => {
  try {
    const logs = fs.readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim());
    return logs.slice(-limit);
  } catch (error) {
    return [];
  }
};

module.exports = {
  logGoogleAuthAttempt,
  logGoogleAuthError,
  getGoogleAuthLogs
};
