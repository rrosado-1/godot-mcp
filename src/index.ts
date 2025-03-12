#!/usr/bin/env node
/**
 * Godot MCP Server
 * 
 * This MCP server provides tools for interacting with the Godot game engine.
 * It enables AI assistants to launch the Godot editor, run Godot projects,
 * capture debug output, and control project execution.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

/**
 * Interface representing a running Godot process
 */
interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
}

/**
 * Interface for server configuration
 */
interface GodotServerConfig {
  godotPath?: string;
  debugMode?: boolean;
}

/**
 * Main server class for the Godot MCP server
 */
class GodotServer {
  private server: Server;
  private activeProcess: GodotProcess | null = null;
  private godotPath: string = '/Applications/Godot.app/Contents/MacOS/Godot'; // Default for macOS
  private debugMode: boolean = false;

  constructor(config?: GodotServerConfig) {
    // Apply configuration if provided
    if (config) {
      if (config.godotPath) {
        this.godotPath = config.godotPath;
      }
      if (config.debugMode !== undefined) {
        this.debugMode = config.debugMode;
      }
    }

    // Apply environment variables (override config)
    if (process.env.GODOT_PATH) {
      this.godotPath = process.env.GODOT_PATH;
      this.logDebug(`Using Godot path from environment: ${this.godotPath}`);
    }
    if (process.env.DEBUG === 'true') {
      this.debugMode = true;
      this.logDebug('Debug mode enabled from environment');
    }

    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'godot-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up tool handlers
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    
    // Cleanup on exit
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    // Detect OS and set appropriate Godot path
    this.detectGodotPath();
  }

  /**
   * Log debug messages if debug mode is enabled
   */
  private logDebug(message: string): void {
    if (this.debugMode) {
      console.log(`[DEBUG] ${message}`);
    }
  }

  /**
   * Create a standardized error response with possible solutions
   */
  private createErrorResponse(message: string, possibleSolutions: string[] = []): any {
    const response: any = {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    };
    
    if (possibleSolutions.length > 0) {
      response.content.push({
        type: 'text',
        text: 'Possible solutions:\n- ' + possibleSolutions.join('\n- '),
      });
    }
    
    return response;
  }

  /**
   * Validate a path to prevent path traversal attacks
   */
  private validatePath(path: string): boolean {
    // Basic validation to prevent path traversal
    if (!path || path.includes('..')) {
      return false;
    }
    
    // Add more validation as needed
    return true;
  }

  /**
   * Detect the Godot executable path based on the operating system
   */
  private async detectGodotPath() {
    // Skip if path was provided via config or environment
    if (process.env.GODOT_PATH) {
      this.logDebug('Using Godot path from environment, skipping detection');
      return;
    }

    const platform = process.platform;
    this.logDebug(`Detecting Godot path for platform: ${platform}`);
    
    const possiblePaths: Record<string, string[]> = {
      darwin: [
        '/Applications/Godot.app/Contents/MacOS/Godot',
        '/Applications/Godot_4.app/Contents/MacOS/Godot',
        `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`
      ],
      win32: [
        'C:\\Program Files\\Godot\\Godot.exe',
        'C:\\Program Files (x86)\\Godot\\Godot.exe',
        'C:\\Program Files\\Godot_4\\Godot.exe',
        'C:\\Program Files (x86)\\Godot_4\\Godot.exe'
      ],
      linux: [
        '/usr/bin/godot',
        '/usr/local/bin/godot',
        '/snap/bin/godot',
        `${process.env.HOME}/.local/bin/godot`
      ]
    };

    // Try each possible path for the current platform
    const paths = possiblePaths[platform] || [];
    for (const path of paths) {
      try {
        this.logDebug(`Checking Godot path: ${path}`);
        if (existsSync(path)) {
          await execAsync(`"${path}" --version`);
          this.godotPath = path;
          this.logDebug(`Found Godot at: ${path}`);
          return;
        }
      } catch (error) {
        // Continue to next path
        this.logDebug(`Path ${path} not valid or executable`);
      }
    }

    this.logDebug(`Warning: Could not find Godot in common locations for ${platform}`);
    this.logDebug(`Using default path: ${this.godotPath}, but this may not work.`);
    console.error(`Warning: Could not find Godot in common locations for ${platform}`);
    console.error(`Using default path: ${this.godotPath}, but this may not work.`);
    console.error('Set GODOT_PATH environment variable to specify the correct path.');
  }

  /**
   * Clean up resources when shutting down
   */
  private async cleanup() {
    this.logDebug('Cleaning up resources');
    if (this.activeProcess) {
      this.logDebug('Killing active Godot process');
      this.activeProcess.process.kill();
      this.activeProcess = null;
    }
    await this.server.close();
  }

  /**
   * Set up the tool handlers for the MCP server
   */
  private setupToolHandlers() {
    // Define available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'launch_editor',
          description: 'Launch Godot editor for a specific project',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'run_project',
          description: 'Run the Godot project and capture output',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scene: {
                type: 'string',
                description: 'Optional: Specific scene to run',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'get_debug_output',
          description: 'Get the current debug output and errors',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'stop_project',
          description: 'Stop the currently running Godot project',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_godot_version',
          description: 'Get the installed Godot version',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'list_projects',
          description: 'List Godot projects in a directory',
          inputSchema: {
            type: 'object',
            properties: {
              directory: {
                type: 'string',
                description: 'Directory to search for Godot projects',
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to search recursively (default: false)',
              },
            },
            required: ['directory'],
          },
        },
        {
          name: 'get_project_info',
          description: 'Retrieve metadata about a Godot project',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'create_scene',
          description: 'Create a new Godot scene file',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path where the scene file will be saved (relative to project)',
              },
              rootNodeType: {
                type: 'string',
                description: 'Type of the root node (e.g., Node2D, Node3D)',
                default: 'Node2D',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'add_node',
          description: 'Add a node to an existing scene',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              parentNodePath: {
                type: 'string',
                description: 'Path to the parent node (e.g., "root" or "root/Player")',
                default: 'root',
              },
              nodeType: {
                type: 'string',
                description: 'Type of node to add (e.g., Sprite2D, CollisionShape2D)',
              },
              nodeName: {
                type: 'string',
                description: 'Name for the new node',
              },
              properties: {
                type: 'object',
                description: 'Optional properties to set on the node',
              },
            },
            required: ['projectPath', 'scenePath', 'nodeType', 'nodeName'],
          },
        },
        {
          name: 'load_sprite',
          description: 'Load a sprite into a Sprite2D node',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              nodePath: {
                type: 'string',
                description: 'Path to the Sprite2D node (e.g., "root/Player/Sprite2D")',
              },
              texturePath: {
                type: 'string',
                description: 'Path to the texture file (relative to project)',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
          },
        },
        {
          name: 'export_mesh_library',
          description: 'Export a scene as a MeshLibrary resource',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (.tscn) to export',
              },
              outputPath: {
                type: 'string',
                description: 'Path where the mesh library (.res) will be saved',
              },
              meshItemNames: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Optional: Names of specific mesh items to include (defaults to all)',
              },
            },
            required: ['projectPath', 'scenePath', 'outputPath'],
          },
        },
        {
          name: 'save_scene',
          description: 'Save changes to a scene file',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              newPath: {
                type: 'string',
                description: 'Optional: New path to save the scene to (for creating variants)',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      this.logDebug(`Handling tool request: ${request.params.name}`);
      switch (request.params.name) {
        case 'launch_editor':
          return await this.handleLaunchEditor(request.params.arguments);
        case 'run_project':
          return await this.handleRunProject(request.params.arguments);
        case 'get_debug_output':
          return await this.handleGetDebugOutput();
        case 'stop_project':
          return await this.handleStopProject();
        case 'get_godot_version':
          return await this.handleGetGodotVersion();
        case 'list_projects':
          return await this.handleListProjects(request.params.arguments);
        case 'get_project_info':
          return await this.handleGetProjectInfo(request.params.arguments);
        case 'create_scene':
          return await this.handleCreateScene(request.params.arguments);
        case 'add_node':
          return await this.handleAddNode(request.params.arguments);
        case 'load_sprite':
          return await this.handleLoadSprite(request.params.arguments);
        case 'export_mesh_library':
          return await this.handleExportMeshLibrary(request.params.arguments);
        case 'save_scene':
          return await this.handleSaveScene(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Handle the launch_editor tool
   * @param args Tool arguments
   */
  private async handleLaunchEditor(args: any) {
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      this.logDebug(`Launching Godot editor for project: ${args.projectPath}`);
      const process = spawn(this.godotPath, ['-e', '--path', args.projectPath], {
        stdio: 'pipe',
      });

      process.on('error', (err) => {
        console.error('Failed to start Godot editor:', err);
      });

      return {
        content: [
          {
            type: 'text',
            text: `Godot editor launched successfully for project at ${args.projectPath}.`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to launch Godot editor: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Handle the run_project tool
   * @param args Tool arguments
   */
  private async handleRunProject(args: any) {
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      // Kill any existing process
      if (this.activeProcess) {
        this.logDebug('Killing existing Godot process before starting a new one');
        this.activeProcess.process.kill();
      }

      const cmdArgs = ['-d', '--path', args.projectPath];
      if (args.scene && this.validatePath(args.scene)) {
        this.logDebug(`Adding scene parameter: ${args.scene}`);
        cmdArgs.push(args.scene);
      }

      this.logDebug(`Running Godot project: ${args.projectPath}`);
      const process = spawn(this.godotPath, cmdArgs, { stdio: 'pipe' });
      const output: string[] = [];
      const errors: string[] = [];

      process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        output.push(...lines);
        if (this.debugMode) {
          lines.forEach((line: string) => {
            if (line.trim()) this.logDebug(`[Godot stdout] ${line}`);
          });
        }
      });

      process.stderr.on('data', (data) => {
        const lines = data.toString().split('\n');
        errors.push(...lines);
        if (this.debugMode) {
          lines.forEach((line: string) => {
            if (line.trim()) this.logDebug(`[Godot stderr] ${line}`);
          });
        }
      });

      process.on('exit', (code) => {
        this.logDebug(`Godot process exited with code ${code}`);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      process.on('error', (err) => {
        console.error('Failed to start Godot process:', err);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      this.activeProcess = { process, output, errors };

      return {
        content: [
          {
            type: 'text',
            text: `Godot project started in debug mode. Use get_debug_output to see output.`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to run Godot project: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Handle the get_debug_output tool
   */
  private async handleGetDebugOutput() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process.',
        [
          'Use run_project to start a Godot project first',
          'Check if the Godot process crashed unexpectedly'
        ]
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              output: this.activeProcess.output,
              errors: this.activeProcess.errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the stop_project tool
   */
  private async handleStopProject() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process to stop.',
        [
          'Use run_project to start a Godot project first',
          'The process may have already terminated'
        ]
      );
    }

    this.logDebug('Stopping active Godot process');
    this.activeProcess.process.kill();
    const output = this.activeProcess.output;
    const errors = this.activeProcess.errors;
    this.activeProcess = null;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: 'Godot project stopped',
              finalOutput: output,
              finalErrors: errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the get_godot_version tool
   */
  private async handleGetGodotVersion() {
    try {
      this.logDebug('Getting Godot version');
      const { stdout } = await execAsync(`"${this.godotPath}" --version`);
      return {
        content: [
          {
            type: 'text',
            text: stdout.trim(),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get Godot version: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly'
        ]
      );
    }
  }

  /**
   * Handle the list_projects tool
   */
  private async handleListProjects(args: any) {
    if (!args.directory) {
      return this.createErrorResponse(
        'Directory is required',
        ['Provide a valid directory path to search for Godot projects']
      );
    }

    if (!this.validatePath(args.directory)) {
      return this.createErrorResponse(
        'Invalid directory path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      this.logDebug(`Listing Godot projects in directory: ${args.directory}`);
      if (!existsSync(args.directory)) {
        return this.createErrorResponse(
          `Directory does not exist: ${args.directory}`,
          ['Provide a valid directory path that exists on the system']
        );
      }

      const recursive = args.recursive === true;
      const projects = this.findGodotProjects(args.directory, recursive);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list projects: ${error?.message || 'Unknown error'}`,
        [
          'Ensure the directory exists and is accessible',
          'Check if you have permission to read the directory'
        ]
      );
    }
  }

  /**
   * Find Godot projects in a directory
   * @param directory Directory to search
   * @param recursive Whether to search recursively
   * @returns Array of Godot projects
   */
  private findGodotProjects(directory: string, recursive: boolean): Array<{path: string, name: string}> {
    const projects: Array<{path: string, name: string}> = [];
    
    try {
      // Check if the directory itself is a Godot project
      const projectFile = join(directory, 'project.godot');
      if (existsSync(projectFile)) {
        projects.push({
          path: directory,
          name: basename(directory),
        });
      }

      // If not recursive, only check immediate subdirectories
      if (!recursive) {
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            }
          }
        }
      } else {
        // Recursive search
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            // Skip hidden directories
            if (entry.name.startsWith('.')) {
              continue;
            }
            // Check if this directory is a Godot project
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            } else {
              // Recursively search this directory
              const subProjects = this.findGodotProjects(subdir, true);
              projects.push(...subProjects);
            }
          }
        }
      }
    } catch (error) {
      this.logDebug(`Error searching directory ${directory}: ${error}`);
    }

    return projects;
  }

  /**
   * Handle the get_project_info tool
   * @param args Tool arguments
   */
  private async handleGetProjectInfo(args: any) {
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      this.logDebug(`Getting project info for: ${args.projectPath}`);
      
      // Read project.godot file to extract metadata
      // This is a simplified implementation - in a real implementation,
      // you would parse the project.godot file to extract more detailed information
      const { stdout } = await execAsync(`"${this.godotPath}" --path "${args.projectPath}" --version-project`);
      
      // Get additional project information
      const projectName = basename(args.projectPath);
      const projectStructure = await this.getProjectStructure(args.projectPath);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                name: projectName,
                path: args.projectPath,
                godotVersion: stdout.trim(),
                structure: projectStructure
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get project info: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Get the structure of a Godot project
   * @param projectPath Path to the Godot project
   * @returns Object representing the project structure
   */
  private async getProjectStructure(projectPath: string): Promise<any> {
    try {
      // Get top-level directories in the project
      const entries = readdirSync(projectPath, { withFileTypes: true });
      
      const structure: any = {
        scenes: [],
        scripts: [],
        assets: [],
        other: []
      };
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name.toLowerCase();
          
          // Skip hidden directories
          if (dirName.startsWith('.')) {
            continue;
          }
          
          // Count files in common directories
          if (dirName === 'scenes' || dirName.includes('scene')) {
            structure.scenes.push(entry.name);
          } else if (dirName === 'scripts' || dirName.includes('script')) {
            structure.scripts.push(entry.name);
          } else if (
            dirName === 'assets' || 
            dirName === 'textures' || 
            dirName === 'models' || 
            dirName === 'sounds' || 
            dirName === 'music'
          ) {
            structure.assets.push(entry.name);
          } else {
            structure.other.push(entry.name);
          }
        }
      }
      
      return structure;
    } catch (error) {
      this.logDebug(`Error getting project structure: ${error}`);
      return { error: 'Failed to get project structure' };
    }
  }


  /**
   * Create a temporary GDScript file
   * @param content The GDScript content
   * @returns Path to the temporary file
   */
  private createTempGDScript(content: string): string {
    const tempDir = tmpdir();
    const scriptId = randomUUID();
    const scriptPath = join(tempDir, `godot_mcp_${scriptId}.gd`);
    
    this.logDebug(`Creating temporary GDScript at: ${scriptPath}`);
    writeFileSync(scriptPath, content);
    
    return scriptPath;
  }

  /**
   * Execute a GDScript file with Godot
   * @param scriptPath Path to the GDScript file
   * @param projectPath Path to the Godot project
   * @returns Output from Godot
   */
  private async executeGDScript(scriptPath: string, projectPath: string): Promise<{stdout: string, stderr: string}> {
    this.logDebug(`Executing GDScript: ${scriptPath} in project: ${projectPath}`);
    
    try {
      const { stdout, stderr } = await execAsync(
        `"${this.godotPath}" --headless --script "${scriptPath}" --path "${projectPath}"`
      );
      
      return { stdout, stderr };
    } catch (error: any) {
      // If execAsync throws, it still contains stdout/stderr
      if (error.stdout !== undefined && error.stderr !== undefined) {
        return { 
          stdout: error.stdout,
          stderr: error.stderr
        };
      }
      
      throw error;
    }
  }

  /**
   * Handle the create_scene tool
   * @param args Tool arguments
   */
  private async handleCreateScene(args: any) {
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!args.scenePath) {
      return this.createErrorResponse(
        'Scene path is required',
        ['Provide a valid path where the scene file will be saved']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      // Set default root node type if not provided
      const rootNodeType = args.rootNodeType || 'Node2D';
      
      // Create the directory for the scene if it doesn't exist
      const sceneDir = dirname(join(args.projectPath, args.scenePath));
      if (!existsSync(sceneDir)) {
        this.logDebug(`Creating directory: ${sceneDir}`);
        mkdirSync(sceneDir, { recursive: true });
      }

      // Create GDScript to create the scene
      const scriptContent = `
#!/usr/bin/env -S godot --headless --script
extends SceneTree

func _init():
    print("Creating scene: ${args.scenePath}")
    
    # Create the root node
    var root = ${rootNodeType}.new()
    root.name = "root"
    
    # Create a packed scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        # Save the scene
        var error = ResourceSaver.save(packed_scene, "${args.scenePath}")
        if error == OK:
            print("Scene created successfully at: ${args.scenePath}")
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))
    
    quit()
`;

      const scriptPath = this.createTempGDScript(scriptContent);
      const { stdout, stderr } = await this.executeGDScript(scriptPath, args.projectPath);
      
      if (stderr && stderr.includes("Failed to")) {
        return this.createErrorResponse(
          `Failed to create scene: ${stderr}`,
          [
            'Check if the root node type is valid',
            'Ensure you have write permissions to the scene path',
            'Verify the scene path is valid'
          ]
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Scene created successfully at: ${args.scenePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create scene: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Handle the add_node tool
   * @param args Tool arguments
   */
  private async handleAddNode(args: any) {
    if (!args.projectPath || !args.scenePath || !args.nodeType || !args.nodeName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodeType, and nodeName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first'
          ]
        );
      }

      // Set default parent node path if not provided
      const parentNodePath = args.parentNodePath || 'root';
      
      // Convert properties object to JSON string if provided
      let propertiesJson = '{}';
      if (args.properties) {
        propertiesJson = JSON.stringify(args.properties);
      }

      // Create GDScript to add the node
      const scriptContent = `
#!/usr/bin/env -S godot --headless --script
extends SceneTree

func _init():
    print("Adding node to scene: ${args.scenePath}")
    
    # Load the scene
    var scene = load("${args.scenePath}")
    if not scene:
        printerr("Failed to load scene: ${args.scenePath}")
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Find the parent node
    var parent = root
    if "${parentNodePath}" != "root":
        parent = root.get_node("${parentNodePath.replace('root/', '')}")
        if not parent:
            printerr("Parent node not found: ${parentNodePath}")
            quit(1)
    
    # Create the new node
    var new_node
    
    # Try to create the node
    try:
        new_node = ${args.nodeType}.new()
    except:
        printerr("Failed to create node of type: ${args.nodeType}")
        printerr("This node type may not exist or may not be instantiable")
        quit(1)
    
    new_node.name = "${args.nodeName}"
    
    # Set properties if provided
    var properties = ${propertiesJson}
    for property in properties:
        if new_node.get("property") != null:  # Check if property exists
            new_node.set(property, properties[property])
    
    # Add the node to the parent
    parent.add_child(new_node)
    new_node.owner = root
    
    # Save the modified scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        var error = ResourceSaver.save(packed_scene, "${args.scenePath}")
        if error == OK:
            print("Node '${args.nodeName}' of type '${args.nodeType}' added successfully")
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))
    
    quit()
`;

      const scriptPath = this.createTempGDScript(scriptContent);
      const { stdout, stderr } = await this.executeGDScript(scriptPath, args.projectPath);
      
      if (stderr && stderr.includes("Failed to")) {
        return this.createErrorResponse(
          `Failed to add node: ${stderr}`,
          [
            'Check if the node type is valid',
            'Ensure the parent node path exists',
            'Verify the scene file is valid'
          ]
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Node '${args.nodeName}' of type '${args.nodeType}' added successfully to '${args.scenePath}'.\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to add node: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Handle the load_sprite tool
   * @param args Tool arguments
   */
  private async handleLoadSprite(args: any) {
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.texturePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodePath, and texturePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath) || 
        !this.validatePath(args.nodePath) || !this.validatePath(args.texturePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first'
          ]
        );
      }

      // Check if the texture file exists
      const texturePath = join(args.projectPath, args.texturePath);
      if (!existsSync(texturePath)) {
        return this.createErrorResponse(
          `Texture file does not exist: ${args.texturePath}`,
          [
            'Ensure the texture path is correct',
            'Upload or create the texture file first'
          ]
        );
      }

      // Create GDScript to load the sprite
      const scriptContent = `
#!/usr/bin/env -S godot --headless --script
extends SceneTree

func _init():
    print("Loading sprite into scene: ${args.scenePath}")
    
    # Load the scene
    var scene = load("${args.scenePath}")
    if not scene:
        printerr("Failed to load scene: ${args.scenePath}")
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Find the sprite node
    var node_path = "${args.nodePath}"
    if node_path.begins_with("root/"):
        node_path = node_path.substr(5)  # Remove "root/" prefix
    
    var sprite_node = null
    if node_path == "":
        # If no node path, assume root is the sprite
        sprite_node = root
    else:
        sprite_node = root.get_node(node_path)
    
    if not sprite_node:
        printerr("Node not found: ${args.nodePath}")
        quit(1)
    
    # Check if the node is a Sprite2D or compatible type
    if not (sprite_node is Sprite2D or sprite_node is Sprite3D or sprite_node is TextureRect):
        printerr("Node is not a sprite-compatible type: " + sprite_node.get_class())
        quit(1)
    
    # Load the texture
    var texture = load("${args.texturePath}")
    if not texture:
        printerr("Failed to load texture: ${args.texturePath}")
        quit(1)
    
    # Set the texture on the sprite
    if sprite_node is Sprite2D or sprite_node is Sprite3D:
        sprite_node.texture = texture
    elif sprite_node is TextureRect:
        sprite_node.texture = texture
    
    # Save the modified scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        var error = ResourceSaver.save(packed_scene, "${args.scenePath}")
        if error == OK:
            print("Sprite loaded successfully with texture: ${args.texturePath}")
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))
    
    quit()
`;

      const scriptPath = this.createTempGDScript(scriptContent);
      const { stdout, stderr } = await this.executeGDScript(scriptPath, args.projectPath);
      
      if (stderr && stderr.includes("Failed to")) {
        return this.createErrorResponse(
          `Failed to load sprite: ${stderr}`,
          [
            'Check if the node path is correct',
            'Ensure the node is a Sprite2D, Sprite3D, or TextureRect',
            'Verify the texture file is a valid image format'
          ]
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Sprite loaded successfully with texture: ${args.texturePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to load sprite: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Handle the export_mesh_library tool
   * @param args Tool arguments
   */
  private async handleExportMeshLibrary(args: any) {
    if (!args.projectPath || !args.scenePath || !args.outputPath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, and outputPath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath) || !this.validatePath(args.outputPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first'
          ]
        );
      }

      // Create the directory for the output if it doesn't exist
      const outputDir = dirname(join(args.projectPath, args.outputPath));
      if (!existsSync(outputDir)) {
        this.logDebug(`Creating directory: ${outputDir}`);
        mkdirSync(outputDir, { recursive: true });
      }

      // Convert meshItemNames array to JSON string if provided
      let meshItemNamesJson = '[]';
      if (args.meshItemNames && Array.isArray(args.meshItemNames)) {
        meshItemNamesJson = JSON.stringify(args.meshItemNames);
      }

      // Create GDScript to export the mesh library
      const scriptContent = `
#!/usr/bin/env -S godot --headless --script
extends SceneTree

func _init():
    print("Exporting MeshLibrary from scene: ${args.scenePath}")
    
    # Load the scene
    var scene = load("${args.scenePath}")
    if not scene:
        printerr("Failed to load scene: ${args.scenePath}")
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Create a new MeshLibrary
    var mesh_library = MeshLibrary.new()
    
    # Get mesh item names if provided
    var mesh_item_names = ${meshItemNamesJson}
    var use_specific_items = mesh_item_names.size() > 0
    
    # Process all child nodes
    var item_id = 0
    for child in root.get_children():
        # Skip if not using all items and this item is not in the list
        if use_specific_items and not (child.name in mesh_item_names):
            continue
            
        # Check if the child has a mesh
        var mesh_instance = null
        if child is MeshInstance3D:
            mesh_instance = child
        else:
            # Try to find a MeshInstance3D in the child's descendants
            for descendant in child.get_children():
                if descendant is MeshInstance3D:
                    mesh_instance = descendant
                    break
        
        if mesh_instance and mesh_instance.mesh:
            print("Adding mesh: " + child.name)
            
            # Add the mesh to the library
            mesh_library.create_item(item_id)
            mesh_library.set_item_name(item_id, child.name)
            mesh_library.set_item_mesh(item_id, mesh_instance.mesh)
            
            # Add collision shape if available
            for collision_child in child.get_children():
                if collision_child is CollisionShape3D and collision_child.shape:
                    mesh_library.set_item_shapes(item_id, [collision_child.shape])
                    break
            
            # Add preview if available
            if mesh_instance.mesh:
                mesh_library.set_item_preview(item_id, mesh_instance.mesh)
            
            item_id += 1
    
    # Save the mesh library
    if item_id > 0:
        var error = ResourceSaver.save(mesh_library, "${args.outputPath}")
        if error == OK:
            print("MeshLibrary exported successfully with " + str(item_id) + " items to: ${args.outputPath}")
        else:
            printerr("Failed to save MeshLibrary: " + str(error))
    else:
        printerr("No valid meshes found in the scene")
    
    quit()
`;

      const scriptPath = this.createTempGDScript(scriptContent);
      const { stdout, stderr } = await this.executeGDScript(scriptPath, args.projectPath);
      
      if (stderr && stderr.includes("Failed to")) {
        return this.createErrorResponse(
          `Failed to export mesh library: ${stderr}`,
          [
            'Check if the scene contains valid 3D meshes',
            'Ensure the output path is valid',
            'Verify the scene file is valid'
          ]
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `MeshLibrary exported successfully to: ${args.outputPath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to export mesh library: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Handle the save_scene tool
   * @param args Tool arguments
   */
  private async handleSaveScene(args: any) {
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and scenePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    // If newPath is provided, validate it
    if (args.newPath && !this.validatePath(args.newPath)) {
      return this.createErrorResponse(
        'Invalid new path',
        ['Provide a valid new path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects'
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first'
          ]
        );
      }

      // If newPath is provided, create the directory if it doesn't exist
      let savePath = args.scenePath;
      if (args.newPath) {
        savePath = args.newPath;
        const newPathDir = dirname(join(args.projectPath, args.newPath));
        if (!existsSync(newPathDir)) {
          this.logDebug(`Creating directory: ${newPathDir}`);
          mkdirSync(newPathDir, { recursive: true });
        }
      }

      // Create GDScript to save the scene
      const scriptContent = `
#!/usr/bin/env -S godot --headless --script
extends SceneTree

func _init():
    print("Saving scene: ${args.scenePath}")
    
    # Load the scene
    var scene = load("${args.scenePath}")
    if not scene:
        printerr("Failed to load scene: ${args.scenePath}")
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Create a packed scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        # Save the scene
        var error = ResourceSaver.save(packed_scene, "${savePath}")
        if error == OK:
            print("Scene saved successfully to: ${savePath}")
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))
    
    quit()
`;

      const scriptPath = this.createTempGDScript(scriptContent);
      const { stdout, stderr } = await this.executeGDScript(scriptPath, args.projectPath);
      
      if (stderr && stderr.includes("Failed to")) {
        return this.createErrorResponse(
          `Failed to save scene: ${stderr}`,
          [
            'Check if the scene file is valid',
            'Ensure you have write permissions to the output path',
            'Verify the scene can be properly packed'
          ]
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Scene saved successfully to: ${savePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to save scene: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Start the MCP server
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Godot MCP server running on stdio');
  }
}

// Create and run the server
const server = new GodotServer();
server.run().catch(console.error);
