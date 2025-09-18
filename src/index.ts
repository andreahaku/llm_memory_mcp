#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';

import { KnowledgeManager } from './KnowledgeManager.js';
import type { NoteType, Scope } from './types/KnowledgeBase.js';

class LLMKnowledgeBaseServer {
  private server: Server;
  private knowledgeManager: KnowledgeManager;

  constructor() {
    this.server = new Server(
      {
        name: 'llm-memory-mcp',
        version: '1.0.0'
      }
    );

    this.knowledgeManager = new KnowledgeManager();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'kb.create',
          description: 'Create a new note in the knowledge base',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['note', 'snippet', 'pattern', 'config', 'fact', 'insight'],
                description: 'Type of note to create'
              },
              title: {
                type: 'string',
                description: 'Title of the note'
              },
              content: {
                type: 'string',
                description: 'Content of the note'
              },
              scope: {
                type: 'string',
                enum: ['global', 'project'],
                description: 'Where to store the note (default: project)'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization'
              },
              language: {
                type: 'string',
                description: 'Programming language (for code snippets)'
              },
              file: {
                type: 'string',
                description: 'Related file path'
              }
            },
            required: ['type', 'title', 'content'],
            additionalProperties: false
          }
        },
        {
          name: 'kb.read',
          description: 'Read a note by ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID'
              },
              scope: {
                type: 'string',
                enum: ['global', 'project'],
                description: 'Scope to search in (searches both if not specified)'
              }
            },
            required: ['id'],
            additionalProperties: false
          }
        },
        {
          name: 'kb.update',
          description: 'Update an existing note',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID'
              },
              title: {
                type: 'string',
                description: 'New title'
              },
              content: {
                type: 'string',
                description: 'New content'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'New tags'
              },
              type: {
                type: 'string',
                enum: ['note', 'snippet', 'pattern', 'config', 'fact', 'insight'],
                description: 'New type'
              },
              scope: {
                type: 'string',
                enum: ['global', 'project'],
                description: 'Scope to search in'
              }
            },
            required: ['id'],
            additionalProperties: false
          }
        },
        {
          name: 'kb.delete',
          description: 'Delete a note',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Note ID'
              },
              scope: {
                type: 'string',
                enum: ['global', 'project'],
                description: 'Scope to search in'
              }
            },
            required: ['id'],
            additionalProperties: false
          }
        },
        {
          name: 'kb.list',
          description: 'List all notes',
          inputSchema: {
            type: 'object',
            properties: {
              scope: {
                type: 'string',
                enum: ['global', 'project', 'all'],
                description: 'Scope to list from (default: all)'
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'kb.search',
          description: 'Search through notes',
          inputSchema: {
            type: 'object',
            properties: {
              q: {
                type: 'string',
                description: 'Search query'
              },
              type: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['note', 'snippet', 'pattern', 'config', 'fact', 'insight']
                },
                description: 'Filter by note types'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags'
              },
              scope: {
                type: 'string',
                enum: ['global', 'project', 'all'],
                description: 'Scope to search in (default: all)'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 50)'
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'kb.stats',
          description: 'Get knowledge base statistics',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'project.info',
          description: 'Get current project information',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'project.init',
          description: 'Initialize project knowledge base (creates .llm-memory/ in project root)',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new McpError(ErrorCode.InvalidRequest, 'Missing arguments');
      }

      try {
        switch (name) {
          case 'kb.create': {
            const id = await this.knowledgeManager.create(
              args.type as NoteType,
              args.title as string,
              args.content as string,
              {
                scope: args.scope as Scope,
                tags: args.tags as string[],
                language: args.language as string,
                file: args.file as string
              }
            );

            return {
              content: [
                {
                  type: 'text',
                  text: `Note created successfully with ID: ${id}`
                }
              ]
            };
          }

          case 'kb.read': {
            const note = await this.knowledgeManager.read(args.id as string, args.scope as Scope);

            if (!note) {
              throw new McpError(ErrorCode.InvalidRequest, `Note ${args.id} not found`);
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(note, null, 2)
                }
              ]
            };
          }

          case 'kb.update': {
            const updates: any = {};
            if (args.title !== undefined) updates.title = args.title;
            if (args.content !== undefined) updates.content = args.content;
            if (args.tags !== undefined) updates.tags = args.tags;
            if (args.type !== undefined) updates.type = args.type;

            const success = await this.knowledgeManager.update(
              args.id as string,
              updates,
              args.scope as Scope
            );

            if (!success) {
              throw new McpError(ErrorCode.InvalidRequest, `Note ${args.id} not found`);
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Note ${args.id} updated successfully`
                }
              ]
            };
          }

          case 'kb.delete': {
            const success = await this.knowledgeManager.delete(args.id as string, args.scope as Scope);

            if (!success) {
              throw new McpError(ErrorCode.InvalidRequest, `Note ${args.id} not found`);
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Note ${args.id} deleted successfully`
                }
              ]
            };
          }

          case 'kb.list': {
            const notes = await this.knowledgeManager.list(args.scope as Scope | 'all');

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    notes: notes.map(note => ({
                      id: note.id,
                      type: note.type,
                      title: note.title,
                      tags: note.tags,
                      scope: note.scope,
                      updatedAt: note.metadata.updatedAt
                    })),
                    total: notes.length
                  }, null, 2)
                }
              ]
            };
          }

          case 'kb.search': {
            const result = await this.knowledgeManager.search({
              q: args.q as string,
              type: args.type as NoteType[],
              tags: args.tags as string[],
              scope: args.scope as Scope | 'all',
              limit: args.limit as number
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            };
          }

          case 'kb.stats': {
            const stats = await this.knowledgeManager.getStats();

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(stats, null, 2)
                }
              ]
            };
          }

          case 'project.info': {
            const projectInfo = this.knowledgeManager.getProjectInfo();

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(projectInfo, null, 2)
                }
              ]
            };
          }

          case 'project.init': {
            const kbDir = this.knowledgeManager.initializeProjectKB();

            return {
              content: [
                {
                  type: 'text',
                  text: `Project knowledge base initialized at: ${kbDir}`
                }
              ]
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'kb://notes/recent',
          name: 'Recent Notes',
          description: 'Recently updated notes',
          mimeType: 'application/json'
        },
        {
          uri: 'kb://project/info',
          name: 'Project Knowledge Base Info',
          description: 'Current project knowledge base information',
          mimeType: 'application/json'
        }
      ]
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      try {
        if (uri === 'kb://notes/recent') {
          const notes = await this.knowledgeManager.list('all');
          const recentNotes = notes.slice(0, 10);

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  title: 'Recent Notes',
                  notes: recentNotes.map(note => ({
                    id: note.id,
                    type: note.type,
                    title: note.title,
                    tags: note.tags,
                    scope: note.scope,
                    updatedAt: note.metadata.updatedAt
                  }))
                }, null, 2)
              }
            ]
          };
        }

        if (uri === 'kb://project/info') {
          const projectInfo = this.knowledgeManager.getProjectInfo();
          const stats = await this.knowledgeManager.getStats();

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  project: projectInfo,
                  stats
                }, null, 2)
              }
            ]
          };
        }

        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Resource access failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('LLM Knowledge Base MCP server running on stdio');
  }
}

const server = new LLMKnowledgeBaseServer();
server.run().catch(console.error);