import ffMpegPath from 'ffmpeg-static';
import ffProbe from 'ffprobe';
import { path as ffProbePath } from 'ffprobe-static';
import fs from 'fs';
import path from 'path';
import sharp, { Sharp } from 'sharp';
import { processManager } from '../index';
import { Color } from './Color';
import { NasUtils } from './NasUtils';
import { ProcessData } from './ProcessManager';
import { Utils } from './Utils';

export type StreamList = {
  streams: {
    video: Array<{
      id: number, width: number, height: number,
      meta: {
        codecName: string | undefined,
        codecDescription: string | undefined,
        profile: string | undefined,
        pixelFormat: string | undefined,
        colorSpace: string | undefined,
        avgFrameRate: string | number | undefined
      },
      tags: { [key: string]: string | undefined }
    }>,
    audio: Array<{ id: number, tags: { [key: string]: string | undefined } }>,
    subtitle: Array<{ id: number, tags: { [key: string]: string | undefined } }>,
    unsupported: Array<{ id: number, tags: { [key: string]: string | undefined } }>
  }
};

export class VideoUtils {
  /**
   * Settings `contentAware` to `true` generally produces higher quality thumbnails (e.g. less black ones)
   * but can drastically increase execution time depending on the input
   */
  static async extractVideoThumbnail(absPath: string, sampleSize: number = 2, width = 500): Promise<{ img: Sharp, done: () => void }> {
    if (sampleSize <= 0) throw new Error('sampleSize has to be positive');

    return new Promise(async (resolve, reject): Promise<void> => {
      if (!path.isAbsolute(absPath)) return reject(new Error('The path needs to be absolute'));

      let videoDuration = 0;

      const ffProbeProcess = processManager.spawn(ffProbePath, ['-select_streams', 'v:0', '-show_entries', 'format=duration', '-print_format', 'json=c=1', absPath]).process;
      let ffProbeOutStr = '';
      ffProbeProcess.stdout.on('data', (chunk) => {
        ffProbeOutStr += chunk.toString();
      });
      ffProbeProcess.on('error', console.error);
      ffProbeProcess.on('close', (code) => {
        if (code == 0) {
          const ffProbeOut = JSON.parse(ffProbeOutStr);

          if (typeof ffProbeOut?.format?.duration == 'string') {
            videoDuration = parseFloat(ffProbeOut.format.duration);
          } else if (typeof ffProbeOut?.format?.duration == 'number') {
            videoDuration = ffProbeOut.format.duration;
          }
        } else {
          // TODO: Use ffmpeg as fallback?
          // let ppOut = '';
          // const pp = processManager.spawn(ffMpegPath, ['-bitexact', '-nostats', '-i', absPath, '-map', 'v:0', '-c:v', 'copy', '-f', 'null', '/dev/null']).process;
          // pp.stderr.on('data', (chunk) => {
          //   ppOut += chunk.toString();
          // });
          // pp.on('error', console.error);
          // pp.on('close', (code) => {
          //   if (code == 0) {
          //     let line = ppOut.substring(ppOut.lastIndexOf('frame='));
          //     line = line.substring(0, line.indexOf('\n'));
          //
          //     for (const s of line.split(' ')) {
          //       const args = s.split('=', 2);
          //
          //       if (args[0] == 'time') {
          //         console.log('Time:', args[1]);
          //       }
          //     }
          //   }
          // });
        }

        const cwd = NasUtils.getTmpDir('thumbnails');
        const args = ['-i', absPath];

        args.unshift('-ss', Math.floor(0.1 * videoDuration).toString(), '-noaccurate_seek');
        args.push('-map', 'v:0', '-vf', `select='eq(pict_type,PICT_TYPE_I)',scale=${width}:-2`, '-vsync', 'vfr');
        args.push('-vframes', sampleSize.toString(), 'frame%01d.png');

        const processInfo = processManager.spawn(ffMpegPath, args, {cwd: cwd.path});
        const process = processInfo.process;
        process.on('error', (err) => reject(err));

        let outBuff = '';
        let errBuff = '';

        process.stdout.on('data', (chunk) => {
          outBuff += chunk.toString();
        });
        process.stderr.on('data', (chunk) => {
          errBuff += chunk.toString();
        });

        process.on('close', async (code): Promise<void> => {
          if (code != 0) {
            return reject(new Error(`Executing command 'ffmpeg' exited with code ${code} (log=${processInfo.logFile},stderr='${errBuff}',stdout='${outBuff}')`));
          }

          let highestDelta = -1;
          let result: Sharp | null = null;
          for (let i = 0; i < sampleSize; ++i) {
            const pic = sharp(path.join(cwd.path, `frame${i + 1}.png`));
            const picStats = await pic.stats();

            const delta = Color.deltaESquared({r: 0, g: 0, b: 0}, picStats.dominant) *
                Color.deltaESquared({r: 255, g: 255, b: 255}, picStats.dominant);

            if (highestDelta == -1 || delta > highestDelta) {
              highestDelta = delta;
              result = pic;
            }
          }

          resolve({
            img: result as Sharp, done: cwd.done
          });
        });
      });
    });
  }

  static async liveTranscodeVideo(absPath: string): Promise<{ m3u8Path: string, processData: ProcessData }> {
    const tmpDir = NasUtils.getTmpDir('live');

    let targetFps: string | number = 30;

    let targetWidth = 1920;
    let targetHeight = 1080;
    let targetBitrate = 10 * 1000 * 1000;   // 10M
    const targetAudioBitrate = 128 * 1000;  // 128k

    const videoMeta = await ffProbe(absPath, {path: ffProbePath});
    let srcAvgFps: number | null = null;

    const audioStreams: Array<{ lang?: string }> = [];
    let hasSubtitles = false;

    let finishedVideoStream = false;
    for (const stream of videoMeta.streams) {
      if (stream.codec_type == 'video') {
        if (finishedVideoStream) continue;

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

        finishedVideoStream = true;
      } else if (stream.codec_type == 'audio') {
        const streamMeta: { lang?: string } = {};

        if (stream.tags.language) {
          streamMeta.lang = stream.tags.language;
        }

        audioStreams.push(streamMeta);
      } else if (stream.codec_type as string == 'subtitle') {
        hasSubtitles = true;
      }
    }

    return new Promise((resolve, reject) => {
      const args = ['-i', absPath, '-bitexact'
        // '-filter_complex', `[v:0]split=2[vTmp01][vTmp02];[vTmp01]scale=${targetWidth}:${targetHeight},fps=${targetFps}[vOut01];[vTmp02]scale=250:-2,fps=${targetFps}[vOut02]`
        // This is how to create a low-res video stream:
        // '-filter_complex', `[v:0]split=2[vTmp01][vTmp02];[vTmp01]scale=${targetWidth}:${targetHeight},fps=${targetFps}[vOut01];[vTmp02]scale=250:-2,fps=${targetFps}[vOut02]`,
      ];

      /* Video streams */
      args.push('-filter_complex');
      if (hasSubtitles) {
        args.push(`[v:0]split=2[vTmp01][vTmp02];[vTmp01]scale=${targetWidth}:${targetHeight},fps=${targetFps}[vOut01];` +
            `[vTmp02]scale=${targetWidth}:${targetHeight},fps=${targetFps},subtitles='${absPath}':stream_index=0,subtitles='${absPath}':stream_index=1[vOut02]`,
            '-map', '[vOut01]',
            '-map', '[vOut02]',
            '-b:v:0', targetBitrate.toString());
      } else {
        args.push(`[v:0]scale=${targetWidth}:${targetHeight},fps=${targetFps}[vOut01]`,
            '-map', '[vOut01]',
            '-b:v:0', targetBitrate.toString());
      }

      /* FPS and Keyframes */
      args.push(
          '-g', `${targetFps}`,
          '-sc_threshold', '0',
          '-vsync', '1',

          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-pix_fmt', 'yuv420p',
          '-bufsize', '1M', // Forces recalculating the current average bitrate every 1M (?)
          '-maxrate', '2M', // Bitrate tolerance of 2M

          /* constant keyframes */
          '-flags', '+cgop'

          // Part of the low-res video stream:
          // '-map', '[vOut02]',
          // '-b:v:1', '6000k',
          // '-maxrate:v:1', '6600k',
          // '-bufsize:v:1', '8000k'
      );

      /* Audio */
      for (let i = 0; i < audioStreams.length; i++) {
        args.push('-map', `a:${i}`);
      }

      args.push(
          '-c:a', 'aac',
          '-b:a', targetAudioBitrate.toString(), // FIXME: Can seriously mess with the audio quality for outputs with more than 2 channels
          '-ac', '2', // Forces 2 audio channels
          '-ar', '48000' // Sampling rate 48kHz // TODO: Use 44.1kHz when source is lower than 48kHz
      );

      /* HLS */
      args.push(
          '-hls_time', '4',
          '-hls_list_size', '0',
          '-hls_segment_type', 'mpegts',
          // '-hls_flags', 'independent_segments',
          '-master_pl_name', 'master.m3u8',
          '-hls_segment_filename', 'stream_%v/%06d.ts',
          '-use_localtime_mkdir', '1');

      const audioGroup = 'defaultAudio';
      let streamMap = '';

      for (let i = 0; i < audioStreams.length; i++) {
        const streamMeta = audioStreams[i];

        streamMap += `a:${i},agroup:${audioGroup}`;

        if (streamMeta.lang) {
          streamMap += `,language:${streamMeta.lang}`;
        }

        streamMap += ' ';
      }

      streamMap += `v:0,agroup:${audioGroup}`;
      if (hasSubtitles) {
        streamMap += ` v:1,agroup:${audioGroup}`;
      }

      args.push('-var_stream_map', streamMap);

      args.push('stream_%v.m3u8');

      const processData = processManager.spawn(ffMpegPath, args, {cwd: tmpDir.path});
      const process = processData.process;
      process.on('error', (err) => reject(err));

      let errBuff = '';
      let m3u8Ready: boolean | null = false; // null means promise has been resolved already

      process.stderr.on('data', (chunk) => {
        if (m3u8Ready == null) return;

        const chunkStr = chunk.toString();

        const masterFile = path.join(tmpDir.path, 'master.m3u8');
        if (m3u8Ready && fs.existsSync(masterFile)) {
          m3u8Ready = null;
          resolve({m3u8Path: masterFile, processData});
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

  static async transcodeVideo(absPath: string, targetDir: string, options: { [key: number]: { hardSub?: boolean } }): Promise<{ file: string }> {
    let targetFps: string | number = 30;

    let targetWidth = 1920;
    let targetHeight = 1080;
    let targetBitrate = 10 * 1000 * 1000;   // 10M
    const targetAudioBitrate = 128 * 1000;  // 128k

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
            targetFps = 30;
            // targetFps = stream.avg_frame_rate;
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

          break;
        }
      }
    }

    const streamsToHardSub: number[] = [];  // subtitle stream id (e.g. 0:s:#)
    const imgStreamsToHardSub: string[] = []; // global id (e.g. 0:#)

    for (const optionsKey in options) {
      const value = options[optionsKey];
      const stream = videoMeta.streams[optionsKey];

      if (stream.codec_type as string == 'subtitle') {
        if (value.hardSub) {
          let subId = -1;
          for (let i = 0; i <= parseInt(optionsKey); ++i) {
            const s = videoMeta.streams[i];

            if (s.codec_type as string == 'subtitle') {
              subId++;
            }
          }

          if (stream.codec_name === 'hdmv_pgs_subtitle') {
            imgStreamsToHardSub.push(optionsKey);
          } else {
            streamsToHardSub.push(subId);
          }
        }
      }
    }

    const streamArgs: string[] = [];
    let complexFilter = '';

    for (const optionsKey in options) {
      const value = options[optionsKey];
      const stream = videoMeta.streams[optionsKey];

      if (stream.codec_type == 'video') {
        let srcMapping = `0:${optionsKey}`;
        let subFilters = '';

        for (const subId of streamsToHardSub) {
          subFilters += `subtitles='${absPath}':original_size=${stream.width}x${stream.height}:stream_index=${subId},`;
        }

        if (complexFilter.length > 0) {
          complexFilter += ';';
        }

        if (imgStreamsToHardSub.length > 0) {
          complexFilter += `[${srcMapping}]`;
          srcMapping = `imgSubs${optionsKey}`;

          for (const streamId of imgStreamsToHardSub) {
            complexFilter += `[0:${streamId}]`;
          }

          // TODO: Testen ob ich einfach filter chainen darf statt nen extra virtual stream zu erstellen der direkt weiter verarbeitet wird
          complexFilter += `overlay=shortest=1,`;
        }

        if (imgStreamsToHardSub.length == 0) {
          complexFilter += `[${srcMapping}]`;
        }

        complexFilter += `${subFilters}scale=${targetWidth}:${targetHeight},fps=${targetFps}[vOut${optionsKey}]`;

        streamArgs.push(
            '-map', `[vOut${optionsKey}]`,
            '-b:v:0', targetBitrate.toString(),
            '-vsync', 'cfr',

            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',

            '-bufsize', '1M', // Forces recalculating the current average bitrate every 1M (?)
            '-maxrate', '2M' // Bitrate tolerance of 2M
        );
      } else if (stream.codec_type == 'audio') {
        streamArgs.push(
            '-map', `0:${optionsKey}`,
            '-c:a', 'aac',
            '-b:a', targetAudioBitrate.toString(), // FIXME: Can seriously mess with the audio quality for outputs with more than 2 channels
            '-ac', '2', // Forces 2 audio channels
            '-ar', '48000' // Sampling rate 48kHz // TODO: Use 44.1kHz when source is lower than 48kHz
        );

      } else if (stream.codec_type as string == 'subtitle') {
        if (!value.hardSub) {
          streamArgs.push(
              '-map', `0:${optionsKey}`,
              '-c:s', 'copy'
          );
        }
      } else {
        throw new Error(`Stream #${optionsKey} has unsupported codec_type of '${stream.codec_type}'`);
      }
    }

    if (complexFilter) {
      streamArgs.unshift('-filter_complex', complexFilter);
    }

    return new Promise((resolve, reject) => {
      const args = ['-n', '-i', absPath, '-bitexact',  /* '-movflags', 'faststart', */

        ...streamArgs
      ];

      const mp4Name = path.basename(absPath) + '.mp4';
      args.push(mp4Name);

      const processInfo = processManager.spawn(ffMpegPath, args, {cwd: targetDir});
      const process = processInfo.process;
      process.on('error', (err) => reject(err));

      process.on('close', (code) => {
        if (code != 0) {
          return reject(new Error(`Executing command 'ffmpeg' exited with code ${code} (Logs written to '${processInfo.logFile}')`));
        } else {
          return resolve({file: path.join(targetDir, mp4Name)});
        }
      });
    });
  }

  static async getStreamList(absPath: string): Promise<StreamList> {
    const videoMeta = await ffProbe(absPath, {path: ffProbePath});

    const result: StreamList = {
      streams: {
        video: [],
        audio: [],
        subtitle: [],
        unsupported: []
      }
    };

    let i = 0;
    for (const stream of videoMeta.streams) {
      if (stream.codec_type == 'video') {
        result.streams.video.push({
          id: i,
          width: parseInt(stream.width as any, 10),   // Types are not accurate so just parse it to be safe
          height: parseInt(stream.height as any, 10), // Types are not accurate so just parse it to be safe
          meta: {
            codecName: stream.codec_name,
            codecDescription: stream.codec_long_name,
            profile: stream.profile,
            pixelFormat: stream.pix_fmt,
            colorSpace: stream.color_space,
            avgFrameRate: stream.avg_frame_rate
          },
          tags: stream.tags
        });
      } else if (stream.codec_type == 'audio') {
        result.streams.audio.push({id: i, tags: stream.tags});
      } else if (stream.codec_type as string == 'subtitle') {
        result.streams.subtitle.push({id: i, tags: stream.tags});
      } else {
        result.streams.unsupported.push({id: i, tags: stream.tags});
      }

      i++;
    }

    return result;
  }
}
