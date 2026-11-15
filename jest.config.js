module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  moduleDirectories: ['node_modules', '<rootDir>/server/node_modules'],
  // Increase timeout for async operations (e.g., DB connections)
  testTimeout: 60000,
  // Load environment variable defaults before any test runs
  setupFilesAfterEnv: ['./jest.setup.js'],
};
