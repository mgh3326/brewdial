#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function smokeTest(): Promise<void> {
  console.log('Starting MCP smoke test...');

  const serverPath = join(__dirname, '..', 'dist', 'index.js');
  const serverProcess = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      API_BASE_URL: 'https://brewdial-mcp-test.invalid',
      AGENT_TOKEN: 'smoke-test-token'
    }
  });

  let stderr = '';
  serverProcess.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  if (serverProcess.exitCode !== null && serverProcess.exitCode !== 0) {
    console.error('Server failed to start');
    console.error('stderr:', stderr);
    process.exit(1);
  }

  try {
    const client = new Client(
      { name: 'smoke-test-client', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        API_BASE_URL: 'https://brewdial-mcp-test.invalid',
        AGENT_TOKEN: 'smoke-test-token'
      }
    });

    await client.connect(transport);

    console.log('\n1. Testing tools/list...');
    const toolsResult = await client.listTools();
    console.log(`   Found ${toolsResult.tools.length} tools:`);
    for (const tool of toolsResult.tools) {
      console.log(`   - ${tool.name}: ${tool.description}`);
    }

    const expectedTools = [
      'brew.create_feedback',
      'brew.create_recipe',
      'brew.update_recipe',
      'brew.archive_recipe',
      'brew.supersede_recipe',
      'brew.find_bean',
      'brew.list_beans',
      'brew.get_recent_context',
      'brew.get_recipe_context'
    ];
    const toolNames = toolsResult.tools.map(t => t.name).sort();
    if (toolsResult.tools.length !== expectedTools.length) {
      throw new Error(`Expected ${expectedTools.length} tools, got ${toolsResult.tools.length}`);
    }
    for (const name of expectedTools) {
      if (!toolNames.includes(name)) {
        throw new Error(`Missing ${name} tool`);
      }
    }

    console.log('\n2. Testing brew.create_recipe validation...');
    const createInvalidResult = await client.callTool({
      name: 'brew.create_recipe',
      arguments: { title: 'Missing method' }
    });
    console.log(`   Result: ${createInvalidResult.content[0].text.substring(0, 100)}...`);
    console.log(`   Is error: ${createInvalidResult.isError}`);
    if (!createInvalidResult.isError) {
      throw new Error('Expected error for invalid create_recipe input');
    }

    console.log('\n3. Testing brew.get_recent_context (expecting backend API error)...');
    const recentResult = await client.callTool({
      name: 'brew.get_recent_context',
      arguments: { limit: 3 }
    });
    console.log(`   Result: ${recentResult.content[0].text.substring(0, 100)}...`);
    console.log(`   Is error: ${recentResult.isError}`);

    console.log('\n4. Testing brew.get_recipe_context with invalid code...');
    const invalidResult = await client.callTool({
      name: 'brew.get_recipe_context',
      arguments: { code: 'INVALID' }
    });
    console.log(`   Result: ${invalidResult.content[0].text}`);
    console.log(`   Is error: ${invalidResult.isError}`);
    if (!invalidResult.isError) {
      throw new Error('Expected error for invalid recipe code');
    }

    console.log('\n5. Testing brew.get_recipe_context with valid code...');
    const validResult = await client.callTool({
      name: 'brew.get_recipe_context',
      arguments: { code: 'COF-0001' }
    });
    console.log(`   Result: ${validResult.content[0].text.substring(0, 100)}...`);
    console.log(`   Is error: ${validResult.isError}`);

    await client.close();

    console.log('\n✅ All smoke tests passed!');
    console.log('\nNote: Errors related to backend API connection are expected');
    console.log('since the smoke test runs without a reachable backend API instance.');

  } catch (error) {
    console.error('\n❌ Smoke test failed:', error);
    serverProcess.kill();
    process.exit(1);
  }

  serverProcess.kill();
}

smokeTest().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
