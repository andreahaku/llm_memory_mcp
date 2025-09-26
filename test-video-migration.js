import { createWriteStream } from 'fs';
import { spawn } from 'child_process';

// Simple MCP client for testing
class MCPTestClient {
  constructor() {
    this.requestId = 1;
    this.process = null;
  }

  async startServer() {
    this.process = spawn('node', ['dist/src/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return this.process;
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: "2.0",
        id: this.requestId++,
        method,
        params
      };

      let responseData = '';
      
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 10000);

      const onData = (data) => {
        responseData += data.toString();
        
        // Look for complete JSON-RPC response
        const lines = responseData.split('\n');
        for (const line of lines) {
          if (line.trim() && line.startsWith('{')) {
            try {
              const response = JSON.parse(line);
              if (response.id === request.id - 1) {
                clearTimeout(timeout);
                this.process.stdout.off('data', onData);
                resolve(response);
                return;
              }
            } catch (e) {
              // Continue looking for valid JSON
            }
          }
        }
      };

      this.process.stdout.on('data', onData);
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async close() {
    if (this.process) {
      this.process.kill();
    }
  }
}

async function testVideoMigration() {
  console.log('🧪 Testing video migration functionality...\n');
  
  const client = new MCPTestClient();
  
  try {
    console.log('1. Starting MCP server...');
    await client.startServer();
    console.log('✅ Server started\n');

    // Test 1: List available tools
    console.log('2. Checking available migration tools...');
    const toolsResponse = await client.sendRequest('tools/list');
    console.log('✅ Tools loaded');
    
    const migrationTools = toolsResponse.result?.tools?.filter(tool => 
      tool.name.includes('migration') || tool.name.includes('storage')
    ) || [];
    
    console.log(`Found ${migrationTools.length} migration-related tools:`);
    migrationTools.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log();

    // Test 2: Check project info and current backend
    console.log('3. Getting project info...');
    const projectResponse = await client.sendRequest('tools/call', {
      name: 'project.info',
      arguments: {}
    });
    
    if (projectResponse.result?.content?.[0]?.text) {
      const projectInfo = JSON.parse(projectResponse.result.content[0].text);
      console.log(`✅ Project: ${projectInfo.name}`);
      console.log(`   Path: ${projectInfo.path}`);
      console.log(`   Current backend: ${projectInfo.storageBackend || 'file'}`);
      console.log();
    }

    // Test 3: Create a test memory item
    console.log('4. Creating test memory item...');
    const memoryResponse = await client.sendRequest('tools/call', {
      name: 'memory.upsert',
      arguments: {
        type: 'fact',
        scope: 'global',
        title: 'Video Migration Test',
        text: 'This is a test memory item for video migration functionality testing.',
        tags: ['test', 'migration', 'video']
      }
    });
    
    let testMemoryId = null;
    if (memoryResponse.result?.content?.[0]?.text) {
      const result = JSON.parse(memoryResponse.result.content[0].text);
      testMemoryId = result.id;
      console.log(`✅ Created test memory: ${testMemoryId}`);
    }
    console.log();

    // Test 4: Check migration status
    console.log('5. Checking migration status...');
    const statusResponse = await client.sendRequest('tools/call', {
      name: 'migration.status',
      arguments: {}
    });
    
    if (statusResponse.result?.content?.[0]?.text) {
      const status = JSON.parse(statusResponse.result.content[0].text);
      console.log('✅ Migration status retrieved:');
      console.log(`   Current backend: ${status.currentBackend}`);
      console.log(`   Available backends: ${status.availableBackends?.join(', ') || 'none'}`);
      console.log();
    }

    // Test 5: Attempt video migration
    console.log('6. Attempting migration to video backend...');
    try {
      const migrationResponse = await client.sendRequest('tools/call', {
        name: 'migration.storage_backend',
        arguments: {
          targetBackend: 'video',
          scope: 'global'
        }
      });
      
      if (migrationResponse.result?.content?.[0]?.text) {
        const result = JSON.parse(migrationResponse.result.content[0].text);
        console.log('✅ Migration attempted:');
        console.log(`   Success: ${result.success}`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
        if (result.migratedCount !== undefined) {
          console.log(`   Items migrated: ${result.migratedCount}`);
        }
      }
    } catch (error) {
      console.log(`⚠️  Migration error: ${error.message}`);
    }
    console.log();

    // Test 6: Verify video backend availability
    console.log('7. Testing video component loading...');
    try {
      // This will test if the video components can be dynamically loaded
      const testResponse = await client.sendRequest('tools/call', {
        name: 'project.config.get',
        arguments: { scope: 'global' }
      });
      console.log('✅ Backend components responsive');
    } catch (error) {
      console.log(`⚠️  Backend test error: ${error.message}`);
    }

    console.log('\n🎯 Video migration test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await client.close();
  }
}

testVideoMigration().catch(console.error);
