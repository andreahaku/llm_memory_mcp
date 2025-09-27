#!/usr/bin/env tsx

import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Storage Adapter Validation Test Runner
 *
 * This script runs the complete validation test suite for video and file storage adapters,
 * generating comprehensive reports on feature parity, performance, and reliability.
 */

interface TestSuite {
  name: string;
  description: string;
  file: string;
  timeout: number;
  critical: boolean;
}

interface TestResult {
  suite: string;
  passed: boolean;
  duration: number;
  summary: string;
  details: string;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'Storage Parity Validation',
    description: 'Comprehensive CRUD operations and data integrity tests',
    file: 'tests/storage-parity-validation.test.ts',
    timeout: 300000, // 5 minutes
    critical: true
  },
  {
    name: 'Migration Validation',
    description: 'Bidirectional migration testing between storage types',
    file: 'tests/migration-validation.test.ts',
    timeout: 600000, // 10 minutes
    critical: true
  },
  {
    name: 'Search Parity Validation',
    description: 'Search functionality and query result consistency',
    file: 'tests/search-parity-validation.test.ts',
    timeout: 480000, // 8 minutes
    critical: false
  },
  {
    name: 'Performance Benchmarks',
    description: 'Performance comparison and efficiency metrics',
    file: 'tests/performance-benchmarks.test.ts',
    timeout: 900000, // 15 minutes
    critical: false
  },
  {
    name: 'Feature Parity Report',
    description: 'Comprehensive feature parity analysis and reporting',
    file: 'tests/feature-parity-report.test.ts',
    timeout: 600000, // 10 minutes
    critical: true
  }
];

async function main(): Promise<void> {
  console.log('🚀 Starting Storage Adapter Validation Test Suite');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const results: TestResult[] = [];

  // Ensure test reports directory exists
  const reportsDir = path.join(process.cwd(), 'test-reports');
  await fs.ensureDir(reportsDir);

  // Run each test suite
  for (const suite of TEST_SUITES) {
    console.log(`\n📋 Running: ${suite.name}`);
    console.log(`   Description: ${suite.description}`);
    console.log(`   Timeout: ${(suite.timeout / 1000 / 60).toFixed(1)} minutes`);

    const result = await runTestSuite(suite);
    results.push(result);

    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    const duration = (result.duration / 1000).toFixed(1);
    console.log(`   Result: ${status} (${duration}s)`);

    if (!result.passed && suite.critical) {
      console.log(`\n❌ CRITICAL TEST FAILURE: ${suite.name}`);
      console.log(`   This is a critical test. Stopping execution.`);
      console.log(`   Details: ${result.details}`);
      break;
    }

    // Brief pause between test suites
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Generate summary report
  await generateSummaryReport(results, Date.now() - startTime);

  // Print final summary
  printFinalSummary(results);
}

async function runTestSuite(suite: TestSuite): Promise<TestResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const jestProcess = spawn('npx', ['jest', suite.file, '--verbose', '--detectOpenHandles'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      timeout: suite.timeout
    });

    let stdout = '';
    let stderr = '';

    jestProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
      // Stream output in real-time for immediate feedback
      process.stdout.write(data);
    });

    jestProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    jestProcess.on('close', (code) => {
      const duration = Date.now() - startTime;
      const passed = code === 0;

      // Extract summary information from Jest output
      const summary = extractJestSummary(stdout, stderr);

      resolve({
        suite: suite.name,
        passed,
        duration,
        summary,
        details: passed ? 'All tests passed successfully' : `Exit code: ${code}, Stderr: ${stderr.slice(-200)}`
      });
    });

    jestProcess.on('error', (error) => {
      const duration = Date.now() - startTime;

      resolve({
        suite: suite.name,
        passed: false,
        duration,
        summary: 'Test execution failed',
        details: error.message
      });
    });

    // Handle timeout
    setTimeout(() => {
      if (jestProcess.pid) {
        jestProcess.kill('SIGTERM');
        const duration = Date.now() - startTime;

        resolve({
          suite: suite.name,
          passed: false,
          duration,
          summary: 'Test timed out',
          details: `Test suite exceeded ${suite.timeout / 1000}s timeout`
        });
      }
    }, suite.timeout);
  });
}

function extractJestSummary(stdout: string, stderr: string): string {
  // Try to extract Jest's test summary
  const lines = stdout.split('\n');

  // Look for Jest summary patterns
  for (const line of lines.reverse()) {
    if (line.includes('Test Suites:') || line.includes('Tests:')) {
      return line.trim();
    }
  }

  // Fallback to error information if no summary found
  if (stderr) {
    const errorLines = stderr.split('\n').filter(line => line.trim().length > 0);
    return errorLines[errorLines.length - 1] || 'No summary available';
  }

  return 'Test completed';
}

async function generateSummaryReport(results: TestResult[], totalDuration: number): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join('test-reports', `validation-summary-${timestamp}.md`);

  const passedTests = results.filter(r => r.passed).length;
  const totalTests = results.length;
  const successRate = (passedTests / totalTests) * 100;

  let report = `# Storage Adapter Validation Summary

**Generated:** ${new Date().toISOString()}
**Total Duration:** ${(totalDuration / 1000 / 60).toFixed(1)} minutes
**Success Rate:** ${successRate.toFixed(1)}% (${passedTests}/${totalTests} test suites passed)

## Test Suite Results

`;

  for (const result of results) {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    const duration = (result.duration / 1000).toFixed(1);

    report += `### ${result.suite}
- **Status:** ${status}
- **Duration:** ${duration} seconds
- **Summary:** ${result.summary}
- **Details:** ${result.details}

`;
  }

  report += `## Overall Assessment

`;

  if (successRate === 100) {
    report += `🎉 **EXCELLENT**: All validation tests passed successfully. The video storage adapter demonstrates complete feature parity with the file storage adapter and is ready for production use.

### Recommendations:
- ✅ Deploy video storage adapter to production
- ✅ Begin migration planning for existing data
- ✅ Monitor performance metrics in production environment

`;
  } else if (successRate >= 80) {
    const failedTests = results.filter(r => !r.passed);
    const criticalFailed = failedTests.some(r => TEST_SUITES.find(s => s.name === r.suite)?.critical);

    if (criticalFailed) {
      report += `⚠️ **CRITICAL ISSUES**: Critical validation tests failed. Do not deploy to production without addressing these issues.

### Failed Critical Tests:
${failedTests.filter(r => TEST_SUITES.find(s => s.name === r.suite)?.critical).map(r => `- ${r.suite}: ${r.details}`).join('\n')}

### Recommendations:
- 🔧 Address critical test failures immediately
- 🧪 Re-run validation tests after fixes
- ⏸️ Hold production deployment until 100% critical test success

`;
    } else {
      report += `⚠️ **MINOR ISSUES**: Some non-critical tests failed. Production deployment possible with caution.

### Failed Non-Critical Tests:
${failedTests.map(r => `- ${r.suite}: ${r.details}`).join('\n')}

### Recommendations:
- 🔍 Review failed test details and assess impact
- 📋 Create tickets for addressing non-critical issues
- 🚀 Consider phased production rollout

`;
    }
  } else {
    report += `❌ **MAJOR ISSUES**: Significant validation failures detected. Do not deploy to production.

### Failed Tests:
${results.filter(r => !r.passed).map(r => `- ${r.suite}: ${r.details}`).join('\n')}

### Recommendations:
- 🛑 Do not deploy video storage adapter to production
- 🔧 Address all failed tests before reconsidering deployment
- 📊 Conduct thorough analysis of compatibility issues

`;
  }

  report += `## Next Steps

1. **Review detailed test reports** in the test-reports directory
2. **Address any failed tests** according to their priority
3. **Re-run validation tests** after making fixes
4. **Update documentation** based on test results
5. **Plan production migration** if tests are successful

---
*Generated by Storage Adapter Validation Test Runner*
`;

  await fs.writeFile(reportPath, report);
  console.log(`\n📋 Summary report generated: ${reportPath}`);
}

function printFinalSummary(results: TestResult[]): void {
  const passedTests = results.filter(r => r.passed).length;
  const totalTests = results.length;
  const successRate = (passedTests / totalTests) * 100;

  console.log('\n' + '='.repeat(60));
  console.log('🎯 VALIDATION TEST SUITE SUMMARY');
  console.log('='.repeat(60));

  console.log(`\n📊 Overall Results:`);
  console.log(`   Success Rate: ${successRate.toFixed(1)}% (${passedTests}/${totalTests})`);

  if (successRate === 100) {
    console.log(`   Status: 🎉 ALL TESTS PASSED`);
    console.log(`   Recommendation: ✅ Ready for production deployment`);
  } else if (successRate >= 80) {
    const criticalFailed = results.some(r => !r.passed && TEST_SUITES.find(s => s.name === r.suite)?.critical);
    if (criticalFailed) {
      console.log(`   Status: ❌ CRITICAL FAILURES`);
      console.log(`   Recommendation: 🛑 Fix critical issues before deployment`);
    } else {
      console.log(`   Status: ⚠️ MINOR ISSUES`);
      console.log(`   Recommendation: 🔍 Review issues, consider phased rollout`);
    }
  } else {
    console.log(`   Status: ❌ MAJOR FAILURES`);
    console.log(`   Recommendation: 🛑 Do not deploy - address failures`);
  }

  console.log(`\n📋 Individual Test Results:`);
  for (const result of results) {
    const status = result.passed ? '✅' : '❌';
    const duration = (result.duration / 1000).toFixed(1);
    console.log(`   ${status} ${result.suite} (${duration}s)`);
  }

  console.log(`\n📁 Detailed reports available in: test-reports/`);
  console.log('\n🏁 Validation test suite completed.');
}

// Handle process signals for graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Validation test suite interrupted by user');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Validation test suite terminated');
  process.exit(1);
});

// Run the validation suite
if (require.main === module) {
  main().catch((error) => {
    console.error('\n❌ Validation test suite failed:', error);
    process.exit(1);
  });
}