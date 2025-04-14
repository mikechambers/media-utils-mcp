# Media Utils MCP

MCP Server that provides information on Images and Video files.

## Requirements

### FFMPEG

[Download FFMPEG](https://www.ffmpeg.org/download.html) and make sure that it's in your system path.

On MacOS you can run:

```bash
brew install ffmpeg
```

On Ubuntu/Debian:

```bash
sudo apt install ffmpeg
```

On Windows, use Chocolatey:

```
choco install ffmpeg
```

## Installation

Install the required dependencies:

```bash
npm install @modelcontextprotocol/sdk sharp fluent-ffmpeg zod
```

To install into Claude desktop, add the following to the __claude_desktop_config.json__ file.

```
    "media-utils": {
      "command": "npx",
      "args": [
        "-y",
        "node",
        "/Users/FOO/src/media-utils-mcp/src/media-utils-mcp.js",
        "--permitted",
        "/Users/FOO/Desktop/mcp"
      ]
    }
```

## Usage

To run the server:

```bash
node src/media-utils-mcp.js --permitted /path/to/dir1 /path/to/dir2
```

The `--permitted` flag is used to specify which directories roots the MCP is allowed to access for security reasons.

## Development

You can run in development using the [MCP inspector](https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file):

```
npx @modelcontextprotocol/inspector node src/media-utils-mcp.js --permitted /Users/FOO/Desktop/mcp/
```

## Features

This MCP provides tools for analyzing media files:

- **getMediaInfo**: Automatically detects whether files are images or videos and returns appropriate metadata

- **getAllowedDirectories** : List the directories the MCP has access to (specified in config)

## License

Project released under a [MIT License](LICENSE.md).

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE.md)
