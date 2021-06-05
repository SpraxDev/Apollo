import { spawn } from 'child_process';
import ffMpegPath from 'ffmpeg-static';
import ffProbe from 'ffprobe';
import { path as ffProbePath } from 'ffprobe-static';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { NasUtils } from './NasUtils';
import { Utils } from './Utils';

const fsStat = promisify(fs.stat);
const fsOpenDir = promisify(fs.opendir);
const fsMkdtemp = promisify(fs.mkdtemp);
const fsMkdir = promisify(fs.mkdir);
const fsRm = promisify(fs.rm);

export class VideoUtils {
  static async liveEncodeVideo(absPath: string): Promise<{ m3u8Path: string }> {
    const tmpDir = await NasUtils.getTmpDir('live');

    let targetFps: string | number = 30;

    let targetWidth = 1920;
    let targetHeight = 1080;
    let targetBitrate = 10 * 1000 * 1000;   // 10M
    // const targetAudioBitrate = 128 * 1000;  // 128k

    const videoMeta = await ffProbe(absPath, {path: ffProbePath});
    let srcAvgFps: number | null = null;

    for (const stream of videoMeta.streams) {
      if (stream.codec_type == 'video') {
        if (typeof stream.width == 'number' && typeof stream.height == 'number') {
          const streamAvgFrameRateIsSlashNotation = /^(\d+|\d+\.\d+)\/(\d+|\d+\.\d+)$/.test(stream.avg_frame_rate); // Checks if input looks like e.g. 10/10

          // Calculate average source framerate for further comparison
          if (streamAvgFrameRateIsSlashNotation) {
            srcAvgFps = parseFloat(stream.avg_frame_rate.substring(0, stream.avg_frame_rate.indexOf('/'))) / parseFloat(stream.avg_frame_rate.substring(stream.avg_frame_rate.indexOf('/') + 1));
          } else if (Utils.isNumeric(stream.avg_frame_rate)) {
            srcAvgFps = parseInt(stream.avg_frame_rate);
          } else {
            console.error(`Could not determine target FPS for value '${stream.avg_frame_rate}' (${absPath})`);
          }

          // Resize keeping aspect ratio and without raising the resolution
          const ratio = Math.min(1920 / stream.width, 1080 / stream.height);
          targetWidth = Math.min(stream.width, Math.round(stream.width * ratio));
          targetHeight = Math.min(stream.height, Math.round(stream.height * ratio));

          if (targetHeight > stream.height || targetWidth > stream.width) {
            targetWidth = stream.width;
            targetHeight = stream.height;
          }

          // Allow for 60 fps if resolution greater or equals 1920x1080
          if (targetWidth >= 1920 &&
              targetHeight >= 1080 &&
              typeof srcAvgFps == 'number' &&
              srcAvgFps >= 60) {
            targetFps = 60;
          } else {
            // targetFps = 30;
            targetFps = stream.avg_frame_rate;
          }

          // Apply default bitrate based on resolution and fps
          if (targetFps >= 60) {
            targetBitrate = 12 * 1000 * 1000;   // 12M
          } else if (targetWidth >= 1920 && targetHeight >= 1080) {
            targetBitrate = 10 * 1000 * 1000;   // 10M
          } else if (targetWidth >= 1280 && targetHeight >= 720) {
            targetBitrate = 4 * 1000 * 1000;    // 4M
          } else {
            targetBitrate = 1.5 * 1000 * 1000;  // 1.5M
          }

          // Make sure the target bitrate does not exceed the source bitrate
          const srcBitrate = stream.max_bit_rate ?? stream.bit_rate;
          if (typeof srcBitrate == 'number' && targetBitrate * 1000 > srcBitrate) {
            targetBitrate = srcBitrate;
          }
        }

        break;
      }
    }

    return new Promise((resolve, reject) => {
      const process = spawn(ffMpegPath, ['-i', absPath, '-hide_banner', '-bitexact',
        '-filter_complex', `[v:0]split=2[vTmp01][vTmp02];[vTmp01]scale=${targetWidth}:${targetHeight},fps=${targetFps}[vOut01];[vTmp02]scale=250:-2,fps=${targetFps}[vOut02]`,

        /* FPS and Keyframes */
        '-g', `${targetFps}`,
        '-sc_threshold', '0',
        '-vsync', '1',

        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-bufsize', '1M', // Forces recalculating the current average bitrate every 1M (?)
        '-maxrate', '2M', // Bitrate tolerance of 2M


        /* constant keyframes */
        '-flags', '+cgop',

        '-map', '[vOut01]',
        '-b:v:0', targetBitrate.toString(), // Average bitrate of 10M

        '-map', '[vOut02]',
        '-b:v:1', '6000k',
        '-maxrate:v:1', '6600k',
        '-bufsize:v:1', '8000k',

        /* Audio */
        '-map', 'a:0',
        '-map', 'a:1',
        '-c:a', 'aac',
        // // '-b:a', targetAudioBitrate.toString(), // FIXME: Can seriously mess with the audio quality for outputs with more than 2 channels
        '-ar', '48000', // Sampling rate 48kHz

        /* HLS */
        '-hls_time', '4',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'independent_segments',
        '-master_pl_name', 'master.m3u8',
        '-hls_segment_filename', 'stream_%v/%06d.ts',
        '-use_localtime_mkdir', '1',
        '-var_stream_map', 'a:1,agroup:audio128,language:ja a:0,agroup:audio128,language:en v:0,agroup:audio128 v:1,agroup:audio128',

        'stream_%v.m3u8'], {cwd: tmpDir.path});
      process.on('error', (err) => reject(err));

      let errBuff = '';
      let m3u8Ready: boolean | null = false; // null means promise has been resolved already

      process.stderr.on('data', (chunk) => {
        if (m3u8Ready == null) return;

        const chunkStr = chunk.toString();

        const masterFile = path.join(tmpDir.path, 'master.m3u8');
        if (m3u8Ready && fs.existsSync(masterFile)) {
          m3u8Ready = null;
          resolve({m3u8Path: masterFile});
        } else if (chunkStr.includes('master.m3u8') && chunkStr.trimEnd().endsWith('for writing')) {
          m3u8Ready = true; // Wait for next data before resolving to make sure the first write has finished
        } else {
          errBuff += chunkStr;
        }
      });

      process.on('close', (code) => {
        if (code != 0) {
          return reject(new Error(`Executing command 'ffmpeg' exited with code ${code} (stderr='${errBuff}',stdout=undefined)`));
        }
      });
    });
  }
}
