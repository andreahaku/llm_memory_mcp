#!/usr/bin/env node

import { KnowledgeManager } from './dist/KnowledgeManager.js';

async function testCRUDOperations() {
  console.log('🧪 Testing LLM Memory MCP Server CRUD Operations\n');

  const manager = new KnowledgeManager();

  try {
    // Test 1: Create operations
    console.log('1️⃣ Testing CREATE operations...');

    const note1Id = await manager.create(
      'note',
      'Test Note 1',
      'This is a test note for basic functionality',
      {
        scope: 'global',
        tags: ['test', 'basic']
      }
    );
    console.log(`✅ Created global note: ${note1Id}`);

    const snippet1Id = await manager.create(
      'snippet',
      'React useState Hook',
      'const [state, setState] = useState(initialValue);',
      {
        scope: 'project',
        tags: ['react', 'hooks', 'javascript'],
        language: 'javascript'
      }
    );
    console.log(`✅ Created project snippet: ${snippet1Id}`);

    const pattern1Id = await manager.create(
      'pattern',
      'Error Handling Pattern',
      `try {
  const result = await asyncOperation();
  return result;
} catch (error) {
  console.error('Operation failed:', error);
  throw new Error('Custom error message');
}`,
      {
        scope: 'project',
        tags: ['javascript', 'async', 'error-handling'],
        language: 'javascript'
      }
    );
    console.log(`✅ Created project pattern: ${pattern1Id}`);

    // Test 2: Read operations
    console.log('\n2️⃣ Testing READ operations...');

    const readNote = await manager.read(note1Id);
    if (readNote && readNote.title === 'Test Note 1') {
      console.log('✅ Successfully read global note');
      console.log(`   Title: ${readNote.title}`);
      console.log(`   Type: ${readNote.type}`);
      console.log(`   Scope: ${readNote.scope}`);
      console.log(`   Tags: ${readNote.tags.join(', ')}`);
    } else {
      console.log('❌ Failed to read global note');
    }

    const readSnippet = await manager.read(snippet1Id);
    if (readSnippet && readSnippet.title === 'React useState Hook') {
      console.log('✅ Successfully read project snippet');
      console.log(`   Language: ${readSnippet.metadata.language}`);
    } else {
      console.log('❌ Failed to read project snippet');
    }

    // Test 3: List operations
    console.log('\n3️⃣ Testing LIST operations...');

    const allNotes = await manager.list('all');
    console.log(`✅ Listed all notes: found ${allNotes.length} notes`);

    const globalNotes = await manager.list('global');
    console.log(`✅ Listed global notes: found ${globalNotes.length} notes`);

    const projectNotes = await manager.list('project');
    console.log(`✅ Listed project notes: found ${projectNotes.length} notes`);

    // Test 4: Search operations
    console.log('\n4️⃣ Testing SEARCH operations...');

    const searchResults = await manager.search({
      q: 'react',
      scope: 'all'
    });
    console.log(`✅ Search for 'react': found ${searchResults.notes.length} results`);

    const tagSearchResults = await manager.search({
      tags: ['javascript'],
      scope: 'all'
    });
    console.log(`✅ Search by tag 'javascript': found ${tagSearchResults.notes.length} results`);

    const typeSearchResults = await manager.search({
      type: ['snippet', 'pattern'],
      scope: 'all'
    });
    console.log(`✅ Search by type (snippet/pattern): found ${typeSearchResults.notes.length} results`);

    // Test 5: Update operations
    console.log('\n5️⃣ Testing UPDATE operations...');

    const updateSuccess = await manager.update(note1Id, {
      title: 'Updated Test Note 1',
      content: 'This note has been updated!',
      tags: ['test', 'updated']
    });

    if (updateSuccess) {
      console.log('✅ Successfully updated note');
      const updatedNote = await manager.read(note1Id);
      console.log(`   New title: ${updatedNote.title}`);
      console.log(`   New tags: ${updatedNote.tags.join(', ')}`);
    } else {
      console.log('❌ Failed to update note');
    }

    // Test 6: Project info
    console.log('\n6️⃣ Testing PROJECT INFO...');

    const projectInfo = manager.getProjectInfo();
    if (projectInfo) {
      console.log('✅ Project info retrieved:');
      console.log(`   ID: ${projectInfo.id}`);
      console.log(`   Name: ${projectInfo.name}`);
      console.log(`   Path: ${projectInfo.path}`);
      console.log(`   Has KB: ${projectInfo.hasKnowledgeBase}`);
    } else {
      console.log('❌ Failed to get project info');
    }

    // Test 7: Statistics
    console.log('\n7️⃣ Testing STATISTICS...');

    const stats = await manager.getStats();
    console.log('✅ Statistics retrieved:');
    console.log(`   Total notes: ${stats.total.notes}`);
    console.log(`   Global notes: ${stats.global.totalNotes}`);
    console.log(`   Project notes: ${stats.project?.totalNotes || 0}`);
    console.log('   By type:');
    Object.entries(stats.total.types).forEach(([type, count]) => {
      if (count > 0) {
        console.log(`     ${type}: ${count}`);
      }
    });

    // Test 8: Delete operations
    console.log('\n8️⃣ Testing DELETE operations...');

    const deleteSuccess = await manager.delete(note1Id);
    if (deleteSuccess) {
      console.log('✅ Successfully deleted note');

      // Verify deletion
      const deletedNote = await manager.read(note1Id);
      if (!deletedNote) {
        console.log('✅ Confirmed note was deleted');
      } else {
        console.log('❌ Note still exists after deletion');
      }
    } else {
      console.log('❌ Failed to delete note');
    }

    // Test 9: Initialize project KB
    console.log('\n9️⃣ Testing PROJECT KB INITIALIZATION...');

    try {
      const kbDir = manager.initializeProjectKB();
      console.log(`✅ Project KB initialized at: ${kbDir}`);
    } catch (error) {
      console.log(`⚠️  Could not initialize project KB: ${error.message}`);
    }

    console.log('\n🎉 All tests completed!');

    // Final cleanup - delete test data
    console.log('\n🧹 Cleaning up test data...');
    await manager.delete(snippet1Id);
    await manager.delete(pattern1Id);
    console.log('✅ Test data cleaned up');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run the tests
testCRUDOperations();