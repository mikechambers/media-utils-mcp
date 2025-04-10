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

