# MIT License
#
# Copyright (c) 2025 Mike Chambers
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from mcp.server.fastmcp import FastMCP
import os
import json
from PIL import Image, ImageCms
from PIL.ExifTags import TAGS, GPSTAGS
import ffmpeg
import sys
import argparse

# Create an MCP server
mcp = FastMCP("MediaUtilsMCP")

permitted_directories = None

def init():
    parser = argparse.ArgumentParser(description="Process multiple directory paths")
    
    # Add the --directories argument that can accept multiple string values
    parser.add_argument(
        '--permitted',
        nargs='+',  # '+' means one or more arguments
        type=str,   # Type of each argument
        help='List of directory paths to process',
        required=True  # Make this argument required
    )
    
    # Parse the arguments
    args = parser.parse_args()
    
    # Access the directories list
    permitted_directories = args.permitted

init()


@mcp.tool()
def get_images_info(image_paths: list[str]) -> list[dict]:
    """
    Returns detailed metadata and properties about multiple image files.
    
    This function extracts comprehensive information about each image including dimensions, file format, color mode, file size, creation date, and other available metadata.
    
    No image processing or modification is performed on the files.
    
    Args:
        image_paths (list[str]): A list of absolute or relative paths to image files.
            Each path must point to an existing image file in a supported format
            (e.g., JPEG, PNG, GIF, TIFF, WebP, BMP).
    
    Returns:
        list[dict]: A list of dictionaries, each containing information about a corresponding image
    """
    
    results = []
    for path in image_paths:
        try:
            info = _get_image_info(path)
            info['path'] = path  # Include the original path in the result
            results.append(info)
        except Exception as e:
            results.append({
                'path': path,
                'error': str(e),
                'success': False
            })
    
    return results

    """
    Returns detailed metadata and properties about multiple image files.
    
    This function extracts comprehensive information about each image including dimensions, 
    file format, color mode, file size, creation date, and other available metadata.
    No image processing or modification is performed on the files.
    
    Args:
        image_paths (list[str]): A list of absolute or relative paths to image files.
            Each path must point to an existing image file in a supported format
            (e.g., JPEG, PNG, GIF, TIFF, WebP, BMP).
    
    Returns:
        list[dict]: A list of dictionaries, each containing information about a corresponding image:
            - format (str): The image file format (e.g., 'JPEG', 'PNG')
            - mode (str): Color mode of the image (e.g., 'RGB', 'RGBA', 'CMYK')
            - size (tuple): Width and height of the image in pixels (width, height)
            - file_size (int): Size of the image file in bytes
            - created (datetime): Creation timestamp of the file
            - modified (datetime): Last modification timestamp
            - exif (dict): EXIF metadata if available (camera settings, GPS, etc.)
            - dpi (tuple): Resolution in dots per inch (horizontal, vertical) if available
            - bit_depth (int): Color depth in bits per channel
            - path (str): The original path of the image

    """
    
    results = []
    for path in image_paths:
        try:
            # Get info for each image and add the path to the result
            info = _get_image_info(path)
            info['path'] = path  # Include the original path in the result
            results.append(info)
        except Exception as e:
            # Optionally handle errors for individual images
            # This allows processing to continue even if one image fails
            results.append({
                'path': path,
                'error': str(e),
                'success': False
            })
    
    return results
@mcp.tool()
def get_videos_info(video_paths: list[str]) -> list[dict]:
    """
    Returns comprehensive information about multiple video files at the specified paths.
    
    This function extracts detailed metadata and technical properties from each video file
    including duration, resolution, codec information, bitrate, frame rate, audio streams,
    and other relevant attributes. No video processing or modification is performed.
    
    Args:
        video_paths (list[str]): A list of absolute or relative paths to video files.
            Each path must point to an existing video file in a supported format
            (e.g., MP4, MOV, AVI, MKV, WebM, WMV).
    
    Returns:
        list[dict]: A list of dictionaries, each containing information about a corresponding video
    """
    
    results = []
    for path in video_paths:
        try:
            info = _get_video_info(path)
            info['path'] = path  # Include the original path in the result
            results.append(info)
        except Exception as e:
            results.append({
                'path': path,
                'error': str(e),
                'success': False
            })
    
    return results


def _get_video_info(video_path):

    check_path(video_path)

    try:
        # Get information about the video file
        probe = ffmpeg.probe(video_path)
        
        # Extract video streams information
        video_streams = [stream for stream in probe['streams'] if stream['codec_type'] == 'video']
        audio_streams = [stream for stream in probe['streams'] if stream['codec_type'] == 'audio']
        
        # Format information
        format_info = probe['format']
        
        # Get framerate if video stream exists
        framerate = None
        
        if video_streams:
            # Get the first video stream
            video_stream = video_streams[0]
            
            # Calculate framerate
            if 'avg_frame_rate' in video_stream:
                # avg_frame_rate is typically in the format "numerator/denominator"
                framerate_parts = video_stream['avg_frame_rate'].split('/')
                if len(framerate_parts) == 2 and int(framerate_parts[1]) != 0:
                    framerate = float(int(framerate_parts[0]) / int(framerate_parts[1]))
        
        return {
            'format': format_info,
            'video_streams': video_streams,
            'audio_streams': audio_streams,
            'duration': float(format_info.get('duration', 0)),
            'size': int(format_info.get('size', 0)),
            'bit_rate': int(format_info.get('bit_rate', 0)),
            'framerate': framerate,
            'path':video_path
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        raise

def _get_image_info(image_path):
    check_path(image_path)
    try:
        # Open the image file
        with Image.open(image_path) as img:
            # Basic image information
            info = {
                'format': img.format,
                'mode': img.mode,
                'width': img.width,
                'height': img.height,
                'resolution': img.info.get('dpi', None),
                'size': os.path.getsize(image_path),
                'filename': os.path.basename(image_path),
                'path':image_path
            }
            
            return info
            
    except Exception as e:
        print(f"Error: {str(e)}")
        raise

def check_path(path, base_paths):
    check_path_exists(path)

    if not is_safe_path(base_paths, path):
        raise ValueError("Path not allowed")
    return True



def check_path_exists(path):
    if os.path.exists(path):
        return True
    else:
        raise FileNotFoundError(f"Path does not exist: {path}")

def is_safe_path(path_to_check):
    base_paths = permitted_directories

    path_to_check = os.path.abspath(os.path.normpath(path_to_check))
    
    # Check each base path
    for base_path in base_paths:
        # Normalize the current base path
        base_path = os.path.abspath(os.path.normpath(base_path))
        
        try:
            # Check if the common path equals the base path
            common_path = os.path.commonpath([base_path, path_to_check])
            if common_path == base_path:
                return True
        except ValueError:
            # commonpath raises ValueError if paths are on different drives
            continue
    
    # If we get here, the path wasn't in any of the base paths
    return False
