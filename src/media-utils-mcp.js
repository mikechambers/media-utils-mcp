import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { parseArgs } from 'node:util';
import { z } from "zod";

const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.bmp', '.svg'];
const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.3gp'];

const IMAGE = "IMAGE"
const VIDEO = "VIDEO"

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

server.resource(
  "getAllowedDirectories",
  "mcp-utils://getAllowedDirectories",
  async () => {
    return {
      contents: [
        {
          type: "text", 
          text: JSON.stringify(permittedDirectories, null, 2),
          uri: "data:text/plain;charset=utf-8"  // Adding the required URI property
        }
      ]
    };
  }
);


// Updated getMediaInfo tool to use the new detectMediaType function
server.tool(
  "getMediaInfo", 
  {
    mediaPaths: z.array(z.string()).describe("A list of media file paths (images or videos) to analyze")
  },
  async ({ mediaPaths }) => {
    const results = [];
    
    for (const filePath of mediaPaths) {
      try {
        checkPath(filePath);
        // Use await with the async detectMediaType function
        const mediaType = await detectMediaType(filePath);
        
        let info;
        if (mediaType.isImage) {
          info = await getImageInfo(filePath);
          info.mediaType = IMAGE;
        } else if (mediaType.isVideo) {
          info = await getVideoInfo(filePath);
          info.mediaType = VIDEO;
        } else {
          throw new Error(`File is not a supported media type: ${mediaType.message}`);
        }
        
        info.success = true;
        results.push(info);
      } catch (e) {
        results.push({
          path: filePath,
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

// Add generateImageFromVideo tool
server.tool(
  "generateImagesFromVideos", 
  {
    items: z.array(
      z.object({
        videoPath: z.string().describe("Path to the source video file"),
        imagePath: z.string().describe("Path where the generated PNG image will be saved")
      })
    ).describe("Array of video-to-image conversion tasks")
  },
  async ({ items }) => {
    const results = [];
    
    for (const item of items) {
      try {
        // Check if paths are valid and in permitted directories
        checkPath(item.videoPath);
        
        // Verify the input file is actually a video
        const mediaType = await detectMediaType(item.videoPath);

        if (!mediaType.isVideo) {
          throw new Error(`File is not a video: ${mediaType.message || 'Invalid file type'}`);
        }
        
        // Ensure the output has .png extension
        let outputPath = item.imagePath;
        const currentExt = path.extname(outputPath).toLowerCase();
        
        if (currentExt !== '.png') {
          // Remove any existing extension and add .png
          outputPath = path.join(
            path.dirname(outputPath),
            `${path.basename(outputPath, path.extname(outputPath))}.png`
          );
        }
        
        // Create directory for output image if it doesn't exist
        const imageDir = path.dirname(outputPath);
        if (!fs.existsSync(imageDir)) {
          fs.mkdirSync(imageDir, { recursive: true });
        }
        
        // Check if the output path is in permitted directories
        checkPath(imageDir);
        
        const thumbnailResult = await generateSmartThumbnail(
          item.videoPath, 
          outputPath
        );
        
        results.push({
          videoPath: item.videoPath,
          imagePath: outputPath, // Return the potentially modified path
          format: 'png',
          success: true,
          ...thumbnailResult
        });
      } catch (e) {
        results.push({
          videoPath: item.videoPath,
          imagePath: item.imagePath,
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

// Add unified media type detection function
async function detectMediaType(filePath) {
  checkPath(filePath);
  
  // Check extension first (fast check)
  const extension = path.extname(filePath).toLowerCase();
  
  let mediaType = {
    type: 'UNKNOWN',
    isVideo: false,
    isImage: false,
    message: null
  };
  
  if (imageExtensions.includes(extension)) {
    mediaType.type = IMAGE;
    mediaType.isImage = true;
  } else if (videoExtensions.includes(extension)) {
    mediaType.type = VIDEO;
    mediaType.isVideo = true;
  }
  
  // For more reliable detection, use content-based checks
  try {
    // Try first as image using sharp - this is faster and more reliable for image check
    try {
      const imageMetadata = await sharp(filePath).metadata();
      mediaType.type = IMAGE;
      mediaType.isImage = true;
      mediaType.metadata = imageMetadata;
      return mediaType;
    } catch (sharpErr) {
      // Not an image, could be a video or something else
      // Now try as video using ffprobe
      const videoCheck = await new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          
          const hasVideoStream = metadata.streams && 
                                metadata.streams.some(stream => stream.codec_type === VIDEO);
          
          if (hasVideoStream) {
            resolve({ 
              success: true, 
              metadata,
              hasVideoStream: true
            });
          } else {
            resolve({ 
              success: true, 
              metadata,
              hasVideoStream: false 
            });
          }
        });
      });
      
      if (videoCheck.success && videoCheck.hasVideoStream) {
        mediaType.type = VIDEO;
        mediaType.isVideo = true;
        mediaType.metadata = videoCheck.metadata;
        return mediaType;
      }
      
      // Not a video with video streams either
      if (videoCheck.success) {
        // It's a file ffprobe recognizes but no video streams
        // Might be audio-only or other media
        mediaType.type = 'OTHER_MEDIA';
        mediaType.message = 'File is recognized by ffprobe but contains no video streams';
        mediaType.metadata = videoCheck.metadata;
      } else {
        // Not recognized by either tool
        mediaType.type = 'UNKNOWN';
        mediaType.message = `Unrecognized media: ${videoCheck.error}, ${sharpErr.message}`;
      }
    }
  } catch (e) {
    mediaType.message = `Error detecting media type: ${e.message}`;
  }
  
  return mediaType;
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
      const videoStreams = metadata.streams.filter(stream => stream.codec_type === VIDEO);
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

// Add the helper function for generating smart thumbnails using the thumbnail filter
function generateSmartThumbnail(videoPath, imagePath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        // Use the thumbnail filter which selects a representative frame
        '-vf thumbnail',
        // Take only one frame
        '-frames:v 1'
      ])
      .output(imagePath)
      .on('error', (err) => {
        console.error(`Error generating thumbnail: ${err.message}`);
        reject(err);
      })
      .on('end', () => {
        // Get info about the generated image
        sharp(imagePath)
          .metadata()
          .then((metadata) => {
            resolve({
              width: metadata.width,
              height: metadata.height,
              size: fs.statSync(imagePath).size
            });
          })
          .catch(err => {
            // If we can't get metadata, at least confirm it was created
            if (fs.existsSync(imagePath)) {
              resolve({
                size: fs.statSync(imagePath).size,
                note: "Image created but metadata could not be read"
              });
            } else {
              reject(new Error("Failed to generate image"));
            }
          });
      })
      .run();
  });
}



// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);