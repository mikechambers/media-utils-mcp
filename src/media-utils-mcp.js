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
  `Extracts detailed technical information from media files. This function analyzes one or more image or video files at the specified paths, automatically detecting their media type and returning comprehensive metadata.
  For images, it provides details such as:
  
  * Dimensions (width and height in pixels)
  * Resolution (DPI)
  * Color depth and color space
  * Format (JPEG, PNG, GIF, etc.)
  * Compression type and quality
  * EXIF data when available (camera model, lens, exposure settings, GPS coordinates)
  * Creation and modification timestamps
  
  For videos, it extracts properties including:
  
  * Duration and total frames
  * Resolution and aspect ratio
  * Codec information
  * Frame rate and bitrate
  * Audio tracks information (channels, sample rate, codec)
  * Container format
  * Creation metadata and timestamps`,
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
  `Generates representative thumbnail images from video files.
  
  This function processes multiple video-to-image conversion tasks, automatically extracting a visually significant frame from each source video and saving it as a PNG image at the specified destination path. The tool intelligently analyzes video content to select a meaningful frame rather than simply capturing the first frame.
  
  All generated images are saved in PNG format regardless of the original extension specified in the output path.`,
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

      // Look for creation date in common metadata locations
      let creationDate = null;

      // Check format tags first (most common location)
      if (formatInfo.tags) {
        creationDate = formatInfo.tags.creation_time || 
                      formatInfo.tags.date || 
                      formatInfo.tags.com_apple_quicktime_creationdate;
      }
      
      // If not found in format tags, check video stream tags
      if (!creationDate && videoStreams.length > 0 && videoStreams[0].tags) {
        creationDate = videoStreams[0].tags.creation_time || 
                      videoStreams[0].tags.date;
      }
      
      resolve({
        format: formatInfo,
        video_streams: videoStreams,
        audio_streams: audioStreams,
        duration: parseFloat(formatInfo.duration || '0'),
        size: parseInt(formatInfo.size || '0'),
        bit_rate: parseInt(formatInfo.bit_rate || '0'),
        framerate,
        creation_date: creationDate,
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

server.tool(
  "convertVideos",
  `Converts video files to MP4 format with standardized encoding settings optimized for compatibility and quality.
  
  This function processes multiple video conversion tasks, re-encoding videos using configurable video and audio codecs. The conversion uses high-quality settings suitable for sharing and broad device compatibility.
  
  All output files are saved in MP4 format regardless of the original extension specified in the output path.`,
  {
    items: z.array(
      z.object({
        inputPath: z.string().describe("Path to the source video file to convert"),
        outputPath: z.string().describe("Path where the converted MP4 video will be saved"),
        videoSettings: z.object({
          frameRate: z.number().optional().default(30).describe("Output frame rate (default: 30 fps)"),
          videoBitrate: z.string().optional().default("8000k").describe("Video bitrate (default: 8000k)"),
          bitrateMode: z.enum(["vbr", "cbr", "crf"]).optional().default("vbr").describe("Bitrate mode: 'vbr' for variable bitrate (default), 'cbr' for constant bitrate, 'crf' for constant rate factor (quality-based)"),
          crf: z.number().optional().default(18).describe("Constant Rate Factor value (0-51, lower = higher quality, only used when bitrateMode is 'crf', default: 18)"),
          preset: z.string().optional().default("medium").describe("Encoding preset: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow (default: medium)"),
          audioBitrate: z.string().optional().default("128k").describe("Audio bitrate (default: 128k)"),
          videoCodec: z.string().optional().describe("Video codec to use. Options: 'libx264' (H.264), 'libx265' (H.265/HEVC), 'libvpx-vp9' (VP9), 'av1' (AV1), 'copy' (copy without re-encoding), or 'auto' to keep same as input (default: 'auto')"),
          audioCodec: z.string().optional().describe("Audio codec to use. Options: 'aac', 'mp3', 'libvorbis', 'libopus', 'copy' (copy without re-encoding), or 'auto' to keep same as input (default: 'aac')")
        }).optional().default({})
      })
    ).describe("Array of video conversion tasks")
  },
  async ({ items }) => {
    const results = [];
    
    for (const item of items) {
      try {
        // Check if input path is valid and in permitted directories
        checkPath(item.inputPath);
        
        // Verify the input file is actually a video
        const mediaType = await detectMediaType(item.inputPath);
        if (!mediaType.isVideo) {
          throw new Error(`File is not a video: ${mediaType.message || 'Invalid file type'}`);
        }
        
        // Get input video info to determine original codecs
        const inputInfo = await getVideoCodecInfo(item.inputPath);
        
        // Ensure the output has .mp4 extension
        let outputPath = item.outputPath;
        const currentExt = path.extname(outputPath).toLowerCase();
        
        if (currentExt !== '.mp4') {
          // Remove any existing extension and add .mp4
          outputPath = path.join(
            path.dirname(outputPath),
            `${path.basename(outputPath, path.extname(outputPath))}.mp4`
          );
        }
        
        // Create directory for output video if it doesn't exist
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Check if the output path is in permitted directories
        checkPath(outputDir);
        
        // Get default settings and merge with provided settings
        const settings = {
          frameRate: 30,
          videoBitrate: "8000k",
          bitrateMode: "vbr",
          crf: 18,
          preset: "medium",
          audioBitrate: "128k",
          videoCodec: "auto",
          audioCodec: "aac",
          ...item.videoSettings
        };
        
        // Resolve 'auto' codec settings
        const resolvedSettings = await resolveCodecSettings(settings, inputInfo);
        
        const conversionResult = await convertVideo(
          item.inputPath,
          outputPath,
          resolvedSettings,
          inputInfo
        );
        
        results.push({
          inputPath: item.inputPath,
          outputPath: outputPath, // Return the potentially modified path
          settings: resolvedSettings,
          originalCodecs: {
            video: inputInfo.videoCodec,
            audio: inputInfo.audioCodec
          },
          success: true,
          ...conversionResult
        });
      } catch (e) {
        results.push({
          inputPath: item.inputPath,
          outputPath: item.outputPath,
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

// Helper function to resolve 'auto' codec settings
async function resolveCodecSettings(settings, inputInfo) {
  const resolved = { ...settings };
  
  // Resolve video codec
  if (settings.videoCodec === "auto") {
    resolved.videoCodec = inputInfo.videoCodec || "libx264"; // fallback to H.264 if unknown
  }
  
  // Resolve audio codec
  if (settings.audioCodec === "auto") {
    resolved.audioCodec = inputInfo.audioCodec || "aac"; // fallback to AAC if unknown
  }
  
  return resolved;
}

// Enhanced getVideoCodecInfo function to extract codec information
function getVideoCodecInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Extract video and audio codec information
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
      
      const result = {
        duration: metadata.format.duration,
        size: metadata.format.size,
        format: metadata.format,
        bit_rate: metadata.format.bit_rate,
        videoCodec: videoStream ? getFFmpegCodecName(videoStream.codec_name) : null,
        audioCodec: audioStream ? getFFmpegCodecName(audioStream.codec_name) : null,
        videoCodecOriginal: videoStream ? videoStream.codec_name : null,
        audioCodecOriginal: audioStream ? audioStream.codec_name : null
      };
      
      resolve(result);
    });
  });
}

// Helper function to map codec names to FFmpeg encoder names
function getFFmpegCodecName(codecName) {
  const codecMap = {
    // Video codecs
    'h264': 'libx264',
    'hevc': 'libx265',
    'h265': 'libx265',
    'vp9': 'libvpx-vp9',
    'vp8': 'libvpx',
    'av1': 'libaom-av1',
    'mpeg4': 'libxvid',
    'mpeg2video': 'mpeg2video',
    'xvid': 'libxvid',
    'theora': 'libtheora',
    
    // Audio codecs
    'aac': 'aac',
    'mp3': 'libmp3lame',
    'vorbis': 'libvorbis',
    'opus': 'libopus',
    'flac': 'flac',
    'pcm_s16le': 'pcm_s16le',
    'ac3': 'ac3',
    'eac3': 'eac3'
  };
  
  return codecMap[codecName.toLowerCase()] || codecName;
}

function convertVideo(inputPath, outputPath, settings, inputInfo) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    let ffmpegCommand = ffmpeg(inputPath);
    
    // Set video codec
    if (settings.videoCodec === 'copy') {
      ffmpegCommand = ffmpegCommand.videoCodec('copy');
    } else {
      ffmpegCommand = ffmpegCommand
        .videoCodec(settings.videoCodec)
        .fps(settings.frameRate);
      
      // Only apply preset for encoding codecs (not copy)
      if (settings.videoCodec.includes('libx264') || settings.videoCodec.includes('libx265')) {
        ffmpegCommand = ffmpegCommand.outputOptions([`-preset ${settings.preset}`]);
      }
      
      // Apply bitrate mode settings (only when re-encoding)
      switch (settings.bitrateMode) {
        case 'cbr':
          const bitrateValue = settings.videoBitrate;
          const bufferSize = `${parseInt(bitrateValue) * 2}k`;
          ffmpegCommand = ffmpegCommand
            .videoBitrate(bitrateValue)
            .outputOptions([
              `-minrate ${bitrateValue}`,
              `-maxrate ${bitrateValue}`,
              `-bufsize ${bufferSize}`
            ]);
          break;
          
        case 'crf':
          ffmpegCommand = ffmpegCommand.outputOptions([`-crf ${settings.crf}`]);
          break;
          
        case 'vbr':
        default:
          ffmpegCommand = ffmpegCommand.videoBitrate(settings.videoBitrate);
          break;
      }
    }
    
    // Set audio codec
    if (settings.audioCodec === 'copy') {
      ffmpegCommand = ffmpegCommand.audioCodec('copy');
    } else {
      ffmpegCommand = ffmpegCommand
        .audioCodec(settings.audioCodec)
        .audioBitrate(settings.audioBitrate);
    }
    
    ffmpegCommand
      .output(outputPath)
      .on('start', (commandLine) => {
        //console.log(`Starting conversion: ${commandLine}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          //console.log(`Processing: ${Math.round(progress.percent)}% done`);
        }
      })
      .on('error', (err) => {
        //console.error(`Error converting video: ${err.message}`);
        reject(err);
      })
      .on('end', () => {
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        // Get info about the converted video
        getVideoCodecInfo(outputPath)
          .then((videoInfo) => {
            resolve({
              duration: videoInfo.duration,
              size: videoInfo.size,
              format: videoInfo.format,
              conversionTime: duration,
              bitRate: videoInfo.bit_rate,
              outputCodecs: {
                video: videoInfo.videoCodec,
                audio: videoInfo.audioCodec
              }
            });
          })
          .catch(err => {
            // If we can't get metadata, at least confirm it was created
            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              resolve({
                size: stats.size,
                conversionTime: duration,
                note: "Video converted but detailed metadata could not be read"
              });
            } else {
              reject(new Error("Failed to convert video"));
            }
          });
      })
      .run();
  });
}




/************* NEW */


// Add this tool to your MCP server

server.tool(
  "splitAudioChannels",
  `Splits stereo audio from media files into separate left and right channel WAV files.
  
  This function extracts the left and right audio channels from video or audio files and saves them as separate mono WAV files. This is useful for analyzing stereo recordings, isolating specific audio tracks, or preparing audio for specialized processing.
  
  All output files are saved in WAV format regardless of the original extension specified in the output paths.`,
  {
    items: z.array(
      z.object({
        inputPath: z.string().describe("Path to the source media file (video or audio) to split"),
        leftChannelPath: z.string().describe("Path where the left channel WAV file will be saved"),
        rightChannelPath: z.string().describe("Path where the right channel WAV file will be saved"),
        audioSettings: z.object({
          sampleRate: z.number().optional().default(44100).describe("Output sample rate in Hz (default: 44100)"),
          bitDepth: z.number().optional().default(16).describe("Output bit depth: 16, 24, or 32 (default: 16)"),
          normalize: z.boolean().optional().default(false).describe("Whether to normalize the audio levels (default: false)")
        }).optional().default({})
      })
    ).describe("Array of audio channel splitting tasks")
  },
  async ({ items }) => {
    const results = [];
    
    for (const item of items) {
      try {
        // Check if input path is valid and in permitted directories
        checkPath(item.inputPath);
        
        // Verify the input file has audio
        const mediaInfo = await getAudioInfo(item.inputPath);
        if (!mediaInfo.hasAudio) {
          throw new Error(`File does not contain audio: ${item.inputPath}`);
        }
        
        if (mediaInfo.channels < 2) {
          throw new Error(`File is not stereo - only has ${mediaInfo.channels} channel(s)`);
        }
        
        // Ensure the output paths have .wav extensions
        let leftPath = ensureWavExtension(item.leftChannelPath);
        let rightPath = ensureWavExtension(item.rightChannelPath);
        
        // Create directories for output files if they don't exist
        const leftDir = path.dirname(leftPath);
        const rightDir = path.dirname(rightPath);
        
        if (!fs.existsSync(leftDir)) {
          fs.mkdirSync(leftDir, { recursive: true });
        }
        if (!fs.existsSync(rightDir)) {
          fs.mkdirSync(rightDir, { recursive: true });
        }
        
        // Check if the output paths are in permitted directories
        checkPath(leftDir);
        checkPath(rightDir);
        
        // Get default settings and merge with provided settings
        const settings = {
          sampleRate: 44100,
          bitDepth: 16,
          normalize: false,
          ...item.audioSettings
        };
        
        const splitResult = await splitStereoChannels(
          item.inputPath,
          leftPath,
          rightPath,
          settings,
          mediaInfo
        );
        
        results.push({
          inputPath: item.inputPath,
          leftChannelPath: leftPath,
          rightChannelPath: rightPath,
          settings: settings,
          originalAudioInfo: {
            channels: mediaInfo.channels,
            sampleRate: mediaInfo.sampleRate,
            duration: mediaInfo.duration,
            codec: mediaInfo.codec
          },
          success: true,
          ...splitResult
        });
        
      } catch (e) {
        results.push({
          inputPath: item.inputPath,
          leftChannelPath: item.leftChannelPath,
          rightChannelPath: item.rightChannelPath,
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

// Helper function to ensure .wav extension
function ensureWavExtension(filePath) {
  const currentExt = path.extname(filePath).toLowerCase();
  
  if (currentExt !== '.wav') {
    return path.join(
      path.dirname(filePath),
      `${path.basename(filePath, path.extname(filePath))}.wav`
    );
  }
  
  return filePath;
}

// Helper function to get audio information from a file
function getAudioInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Find the first audio stream
      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
      
      if (!audioStream) {
        resolve({
          hasAudio: false,
          channels: 0,
          duration: metadata.format.duration || 0
        });
        return;
      }
      
      resolve({
        hasAudio: true,
        channels: audioStream.channels || 0,
        sampleRate: audioStream.sample_rate || 0,
        duration: metadata.format.duration || 0,
        codec: audioStream.codec_name,
        bitRate: audioStream.bit_rate,
        format: metadata.format
      });
    });
  });
}

// Main function to split stereo channels
function splitStereoChannels(inputPath, leftPath, rightPath, settings, mediaInfo) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let completedFiles = 0;
    const totalFiles = 2;
    const results = {
      leftChannel: null,
      rightChannel: null
    };
    
    // Build audio format options based on settings
    const audioFormatOptions = buildAudioFormatOptions(settings);
    
    // Function to handle completion of each channel
    const handleChannelComplete = (channel, fileInfo) => {
      results[channel] = fileInfo;
      completedFiles++;
      
      if (completedFiles === totalFiles) {
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        resolve({
          processingTime: duration,
          leftChannel: results.leftChannel,
          rightChannel: results.rightChannel
        });
      }
    };
    
    // Extract left channel (channel 0)
    ffmpeg(inputPath)
      .audioFilters('pan=mono|c0=0.5*c0+0.5*c1') // Mix left channel to mono
      .audioChannels(1)
      .audioFrequency(settings.sampleRate)
      .outputOptions(audioFormatOptions)
      .output(leftPath)
      .on('error', (err) => {
        reject(new Error(`Error extracting left channel: ${err.message}`));
      })
      .on('end', () => {
        // Get file info
        const stats = fs.statSync(leftPath);
        handleChannelComplete('leftChannel', {
          path: leftPath,
          size: stats.size,
          channel: 'left'
        });
      })
      .run();
    
    // Extract right channel (channel 1)  
    ffmpeg(inputPath)
      .audioFilters('pan=mono|c0=0.5*c2+0.5*c3') // Mix right channel to mono
      .audioChannels(1)
      .audioFrequency(settings.sampleRate)
      .outputOptions(audioFormatOptions)
      .output(rightPath)
      .on('error', (err) => {
        reject(new Error(`Error extracting right channel: ${err.message}`));
      })
      .on('end', () => {
        // Get file info
        const stats = fs.statSync(rightPath);
        handleChannelComplete('rightChannel', {
          path: rightPath,
          size: stats.size,
          channel: 'right'
        });
      })
      .run();
  });
}

// Helper function to build audio format options
function buildAudioFormatOptions(settings) {
  const options = [];
  
  // Set bit depth
  switch (settings.bitDepth) {
    case 16:
      options.push('-acodec pcm_s16le');
      break;
    case 24:
      options.push('-acodec pcm_s24le');
      break;
    case 32:
      options.push('-acodec pcm_s32le');
      break;
    default:
      options.push('-acodec pcm_s16le'); // Default to 16-bit
  }
  
  // Add normalization if requested
  if (settings.normalize) {
    options.push('-af loudnorm');
  }
  
  return options;
}




// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);