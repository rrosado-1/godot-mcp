# Godot MCP

```
                           (((((((             (((((((                          
                        (((((((((((           (((((((((((                      
                        (((((((((((((       (((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
         (((((      (((((((((((((((((((((((((((((((((((((((((      (((((        
       (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((      
     ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
    ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
      (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((     
        (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((       
         (((((((((((@@@@@@@(((((((((((((((((((((((((((@@@@@@@(((((((((((        
         (((((((((@@@@,,,,,@@@(((((((((((((((((((((@@@,,,,,@@@@(((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         (((((((((@@@,,,,,,,@@((((((((@@@@@((((((((@@,,,,,,,@@@(((((((((        
         ((((((((((((@@@@@@(((((((((((@@@@@(((((((((((@@@@@@((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         @@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@        
         ((((((((( @@@(((((((((((@@(((((((((((@@(((((((((((@@@ (((((((((        
         (((((((((( @@((((((((((@@@(((((((((((@@@((((((((((@@ ((((((((((        
          (((((((((((@@@@@@@@@@@@@@(((((((((((@@@@@@@@@@@@@@(((((((((((         
           (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((          
              (((((((((((((((((((((((((((((((((((((((((((((((((((((             
                 (((((((((((((((((((((((((((((((((((((((((((((((                
                        (((((((((((((((((((((((((((((((((                       
                                                                                

                          /$$      /$$  /$$$$$$  /$$$$$$$ 
                         | $$$    /$$$ /$$__  $$| $$__  $$
                         | $$$$  /$$$$| $$  \__/| $$  \ $$
                         | $$ $$/$$ $$| $$      | $$$$$$$/
                         | $$  $$$| $$| $$      | $$____/ 
                         | $$\  $ | $$| $$    $$| $$      
                         | $$ \/  | $$|  $$$$$$/| $$      
                         |__/     |__/ \______/ |__/       
```

A Model Context Protocol (MCP) server for interacting with the Godot game engine.

## Introduction

Godot MCP enables AI assistants to launch the Godot editor, run projects, capture debug output, and control project execution - all through a standardized interface.

This direct feedback loop helps AI assistants like Claude understand what works and what doesn't in real Godot projects, leading to better code generation and debugging assistance.

## Features

- **Launch Godot Editor**: Open the Godot editor for a specific project
- **Run Godot Projects**: Execute Godot projects in debug mode
- **Capture Debug Output**: Retrieve console output and error messages
- **Control Execution**: Start and stop Godot projects programmatically
- **Get Godot Version**: Retrieve the installed Godot version
- **List Godot Projects**: Find Godot projects in a specified directory
- **Project Analysis**: Get detailed information about project structure

## Requirements

- [Godot Engine](https://godotengine.org/download) installed on your system
- Node.js and npm
- An AI assistant that supports MCP

## Installation

1. Clone the repository and install dependencies:
```bash
git clone https://github.com/Coding-Solo/godot-mcp.git
cd godot-mcp
npm install
npm run build
```

2. Configure with Cline:

Add to your Cline MCP settings file (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/path/to/godot-mcp/build/index.js"],
      "disabled": false,
      "autoApprove": [
        "launch_editor",
        "run_project",
        "get_debug_output",
        "stop_project",
        "get_godot_version",
        "list_projects",
        "get_project_info"
      ]
    }
  }
}
```

## Configuration

Configure using environment variables:
- `GODOT_PATH`: Path to the Godot executable (overrides automatic detection)
- `DEBUG`: Set to "true" to enable debug logging

## Configuration with Cursor

### Method 1: Using the Cursor UI

1. Build the MCP server:
```bash
git clone https://github.com/Coding-Solo/godot-mcp.git
cd godot-mcp
npm install
npm run build
```

2. Add the MCP server to Cursor:
   - Go to `Cursor Settings` > `Features` > `MCP`
   - Click on the `+ Add New MCP Server` button
   - Fill out the form:
     - Name: `godot` (or any name you prefer)
     - Type: `stdio`
     - Command: `node /absolute/path/to/godot-mcp/build/index.js`
   - Click "Add"
   - You may need to press the refresh button in the top right corner of the MCP server card to populate the tool list

### Method 2: Using Project-Specific Configuration

Create a file at `.cursor/mcp.json` in your project directory with the following content:

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"]
    }
  }
}
```

### Using with Cursor

Once configured, you can use Cursor's Agent to interact with the Godot MCP server. The Agent will automatically use the MCP tools when relevant, or you can explicitly instruct it to use specific Godot tools.

Example prompts:
```
"Launch the Godot editor for my project at /path/to/project"

"Run my Godot project and show me any errors"

"Get information about my Godot project structure"
```

For more information on using MCP with Cursor, see the [official documentation](https://docs.cursor.com/context/model-context-protocol).

## Using with Cline

Cline provides seamless integration with Godot MCP, allowing you to:

1. **Analyze Godot Projects**: Ask Cline to examine your project structure and suggest improvements
2. **Debug Assistance**: Share error output with Cline to get help debugging issues
3. **Code Generation**: Request Cline to generate GDScript code for specific game mechanics
4. **Interactive Development**: Have Cline run your project and provide real-time feedback

### Example Prompts

```
"Can you analyze my Godot project structure and suggest improvements?"

"Help me debug this error in my Godot project: [paste error]"

"Write a GDScript for a character controller with double jump and wall sliding"
```

## Troubleshooting

- **Godot Not Found**: Set the GODOT_PATH environment variable to your Godot executable
- **Connection Issues**: Ensure the server is running and restart your AI assistant
- **Invalid Project Path**: Ensure the path points to a directory containing a project.godot file

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
