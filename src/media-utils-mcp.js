import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { parseArgs } from 'node:util';
import { z } from "zod";

// Parse command line arguments
const { values } = parseArgs({
  options: {
    permitted: {
      type: 'string',
      multiple: true,
      short: 'p'
    },
    help: {
      type: 'boolean',
      short: 'h'
    }
  }
});

if (values.help) {
  console.log('Usage: node index.js --permitted <dir1> <dir2> ...');
  process.exit(0);
}

// Get permitted directories
const permittedDirectories = values.permitted || [];

// Create an MCP server
const server = new McpServer({
  name: "MediaUtilsMCP",
  version: "1.0.0"
});

// Function to check if a path is safe
function isSafePath(pathToCheck) {
  const normalizedPath = path.normalize(path.resolve(pathToCheck));
  
  for (const basePath of permittedDirectories) {
    const normalizedBasePath = path.normalize(path.resolve(basePath));
    
    try {
      if (normalizedPath.startsWith(normalizedBasePath)) {
        return true;
      }
    } catch (error) {
      continue;
    }
  }
  
  return false;
}

// Check if path exists and is safe
function checkPath(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Path does not exist: ${filePath}`);
  }
  
  if (!isSafePath(filePath)) {
    throw new Error("Path not allowed: Not in permitted directories");
  }
  
  return true;
}


// Get image info helper function
async function getImageInfo(imagePath) {
  checkPath(imagePath);
  
  try {
    const metadata = await sharp(imagePath).metadata();
    const stats = fs.statSync(imagePath);
    
    return {
      format: metadata.format,
      mode: metadata.hasAlpha ? 'RGBA' : 'RGB',
      width: metadata.width,
      height: metadata.height,
      resolution: metadata.density ? [metadata.density, metadata.density] : null,
      size: stats.size,
      filename: path.basename(imagePath),
      path: imagePath
    };
  } catch (e) {
    console.error(`Error: ${e}`);
    throw e;
  }
}

// Get video info helper function
function getVideoInfo(videoPath) {
  checkPath(videoPath);
  
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error(`Error: ${err}`);
        reject(err);
        return;
      }
      
      // Extract video streams
      const videoStreams = metadata.streams.filter(stream => stream.codec_type === 'video');
      const audioStreams = metadata.streams.filter(stream => stream.codec_type === 'audio');
      
      // Format information
      const formatInfo = metadata.format;
      
      // Get framerate if video stream exists
      let framerate = null;
      
      if (videoStreams.length > 0) {
        const videoStream = videoStreams[0];
        
        if (videoStream.avg_frame_rate) {
          const framerateParts = videoStream.avg_frame_rate.split('/');
          if (framerateParts.length === 2 && parseInt(framerateParts[1]) !== 0) {
            framerate = parseFloat((parseInt(framerateParts[0]) / parseInt(framerateParts[1])).toFixed(2));
          }
        }
      }
      
      resolve({
        format: formatInfo,
        video_streams: videoStreams,
        audio_streams: audioStreams,
        duration: parseFloat(formatInfo.duration || '0'),
        size: parseInt(formatInfo.size || '0'),
        bit_rate: parseInt(formatInfo.bit_rate || '0'),
        framerate,
        path: videoPath
      });
    });
  });
}
// Add file type detection function
function detectFileType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  
  // Common image extensions
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.bmp', '.svg'];
  
  // Common video extensions
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.3gp'];
  
  if (imageExtensions.includes(extension)) {
    return 'IMAGE';
  } else if (videoExtensions.includes(extension)) {
    return 'VIDEO';
  } else {
    // Try to determine from file content if extension isn't conclusive
    try {
      // Check if ffprobe can read it as video
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (!err && metadata.streams.some(stream => stream.codec_type === 'video')) {
          return 'VIDEO';
        }
        
        // Try to open with sharp
        sharp(filePath).metadata()
          .then(() => 'IMAGE')
          .catch(() => 'UNKNOWN');
      });
    } catch (e) {
      return 'UNKNOWN';
    }
  }
  
  return 'UNKNOWN';
}

// Add unified API for both media types
server.tool(
  "getMediaInfo", 
  {
    mediaPaths: z.array(z.string()).describe("A list of media file paths (images or videos) to analyze")
  },
  async ({ mediaPaths }) => {
    const results = [];
    
    for (const path of mediaPaths) {
      try {
        checkPath(path);
        const mediaType = detectFileType(path);
        
        let info;
        if (mediaType === 'IMAGE') {
          info = await getImageInfo(path);
          info.mediaType = 'IMAGE';
        } else if (mediaType === 'VIDEO') {
          info = await getVideoInfo(path);
          info.mediaType = 'VIDEO';
        } else {
          // Try both methods if type detection is inconclusive
          try {
            info = await getImageInfo(path);
            info.mediaType = 'IMAGE';
          } catch (imageError) {
            try {
              info = await getVideoInfo(path);
              info.mediaType = 'VIDEO';
            } catch (videoError) {
              throw new Error(`Unable to process file as image or video: ${imageError.message}, ${videoError.message}`);
            }
          }
        }
        
        results.push(info);
      } catch (e) {
        results.push({
          path,
          error: String(e),
          success: false,
          mediaType: 'UNKNOWN'
        });
      }
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);
/*
server.tool(
  "getImagesInfo", 
  {
    imagePaths: z.array(z.string()).describe("A list of image file paths to analyze")
  },
  async ({ imagePaths }) => {
    const results = [];
    
    for (const path of imagePaths) {
      try {
        const info = await getImageInfo(path);
        info.path = path;
        results.push(info);
      } catch (e) {
        results.push({
          path,
          error: String(e),
          success: false
        });
      }
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);
// Add get_videos_info tool
server.tool("get_videos_info", async (args) => {
  const video_paths = args.video_paths || [];
  const results = [];
  
  for (const path of video_paths) {
    try {
      const info = await getVideoInfo(path);
      info.path = path;
      results.push(info);
    } catch (e) {
      results.push({
        path,
        error: String(e),
        success: false
      });
    }
  }
  
  return {
    content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
  };
});
*/

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);