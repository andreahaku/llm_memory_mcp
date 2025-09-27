// Jest setup file for LLM Memory MCP tests

// Set longer timeouts for integration tests
jest.setTimeout(60000);

// Mock console methods for cleaner test output
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  if (process.env.JEST_VERBOSE !== 'true') {
    console.log = jest.fn();
    console.error = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  console.log = originalLog;
  console.error = originalError;
});