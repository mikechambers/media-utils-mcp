# media-utils-mcp.py

MCP Server that provides information on Images and Video files.

## Requirements

### FFMPEG

[Download FFMPEG](https://www.ffmpeg.org/download.html) and make sure that its in your system path.

On MacOS you can run:

```
brew install ffmpeg
```

## Installation

To run the dev server:

```
$cd src
$uv run mcp dev media-utils-mcp.py
```

To install into Claude:

```
uv run mcp install --with Pillow --with ffmpeg-python --with mcp media-utils-mcp.py
```

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

INFO ON HOW TO INSTALL INTO CLAUDE

## Usage

To run the server:

```bash
node src/media-utils-mcp.js --permitted /path/to/dir1 /path/to/dir2
```

The `--permitted` flag is used to specify which directories the MCP is allowed to access for security reasons.

## Development

You can run in development using the [MCP inspector](https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file):

```
npx @modelcontextprotocol/inspector node src/media-utils-mcp.js --permitted /Users/FOO/Desktop/mcp/
```

## Features

This MCP provides tools for analyzing media files:

- **getMediaInfo**: Automatically detects whether files are images or videos and returns appropriate metadata
